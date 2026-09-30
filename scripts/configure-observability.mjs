// Uses the operator's gcloud login; no new service-account key or runtime role.
// PROJECT_ID=... node scripts/configure-observability.mjs [--apply]
// Add ALERT_EMAIL only after the recipient has approved email alerts.
// Run --exclude-raw-logs --apply only after deploying/verifying structured logs.
import {accessToken} from './admin-cloud.mjs';
const project=process.env.PROJECT_ID;
if(!project||!/^[a-z][a-z0-9-]+$/.test(project))throw new Error('Set PROJECT_ID.');
const apply=process.argv.includes('--apply'), exclude=process.argv.includes('--exclude-raw-logs');
const prefix=`projects/${project}`, service='travelguesser';
const base=`resource.type="cloud_run_revision" AND resource.labels.service_name="${service}"`;
const logFilter=`${base} AND jsonPayload.component="tripguessr"`;
const native=type=>`${base} AND metric.type="${type}"`;
const activity=native('logging.googleapis.com/user/tripguessr_activity');
const metric={name:'tripguessr_activity',description:'Successful activity requests, not unique visitors. Closed-set labels only; no identities or private URLs.',filter:`${logFilter} AND jsonPayload.event="request" AND jsonPayload.activity:*`,metricDescriptor:{metricKind:'DELTA',valueType:'INT64',unit:'1',labels:[{key:'activity',valueType:'STRING',description:'Fixed operation category; retries/resumes can count again.'}]},labelExtractors:{activity:'EXTRACT(jsonPayload.activity)'}};
const uptime={displayName:'TripGuessr public HTTPS',monitoredResource:{type:'uptime_url',labels:{project_id:project,host:'tripguessr.com'}},httpCheck:{path:'/api/health',port:443,useSsl:true,validateSsl:true,requestMethod:'GET',acceptedResponseStatusCodes:[{statusValue:200}]},period:'300s',timeout:'30s',selectedRegions:['EUROPE','USA_IOWA','ASIA_PACIFIC'],contentMatchers:[{content:'"status":"ok"',matcher:'CONTAINS_STRING'}]};
if(!apply){console.log(JSON.stringify({project,createOrUpdate:['bounded activity metric','public HTTPS check every 5 minutes from 3 regions','downtime, server error, throttling and application error policies','private operator dashboard'],emailChannel:process.env.ALERT_EMAIL?'provided privately':'none',excludeRawLogs:exclude},null,2));process.exit(0);}
const token=accessToken();
async function api(url,method='GET',body){const r=await fetch(url,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','x-goog-user-project':project},body:body?JSON.stringify(body):undefined});const j=await r.json();if(!r.ok)throw new Error(`${method} ${new URL(url).pathname}: ${r.status} ${j.error?.message}`);return j;}
const logging=`https://logging.googleapis.com/v2/${prefix}`,monitoring=`https://monitoring.googleapis.com/v3/${prefix}`;
const oldMetrics=await api(`${logging}/metrics`);
await api(`${logging}/metrics${oldMetrics.metrics?.some(m=>m.name===metric.name)?'/'+metric.name:''}`,oldMetrics.metrics?.some(m=>m.name===metric.name)?'PUT':'POST',metric);
const oldUptime=(await api(`${monitoring}/uptimeCheckConfigs`)).uptimeCheckConfigs?.find(c=>c.displayName===uptime.displayName);
const check=oldUptime?await api(`https://monitoring.googleapis.com/v3/${oldUptime.name}?updateMask=displayName,httpCheck,period,timeout,selectedRegions,contentMatchers`,'PATCH',{...uptime,name:oldUptime.name}):await api(`${monitoring}/uptimeCheckConfigs`,'POST',uptime);
const channelList=(await api(`${monitoring}/notificationChannels`)).notificationChannels||[];
let channel=channelList.find(c=>c.displayName==='TripGuessr private operator alerts');
if(process.env.ALERT_EMAIL){
 if(channel&&channel.labels.email_address!==process.env.ALERT_EMAIL)throw new Error('An existing alert channel has a different recipient; review it explicitly.');
 channel ||= await api(`${monitoring}/notificationChannels`,'POST',{type:'email',displayName:'TripGuessr private operator alerts',labels:{email_address:process.env.ALERT_EMAIL},enabled:true});
}
const channels=channel?[channel.name]:[];
const threshold=(displayName,filter,aggregation,comparison,thresholdValue,duration='0s')=>({displayName,conditionThreshold:{filter,aggregations:[aggregation],comparison,thresholdValue,duration,...(duration!=='0s'?{evaluationMissingData:'EVALUATION_MISSING_DATA_INACTIVE'}:{})}});
const sum5={alignmentPeriod:'300s',perSeriesAligner:'ALIGN_SUM',crossSeriesReducer:'REDUCE_SUM'};
const policies=[
 {displayName:'TripGuessr - report needs review',conditions:[{displayName:'New private report or reply',conditionMatchedLog:{filter:`${logFilter} AND jsonPayload.event="report_received"`}}],alertStrategy:{notificationRateLimit:{period:'3600s'},autoClose:'1800s'}},
 {displayName:'TripGuessr - daily challenge unavailable',conditions:[{displayName:'Daily schedule or asset unavailable',conditionMatchedLog:{filter:`${logFilter} AND jsonPayload.event="daily_unavailable"`}}],alertStrategy:{notificationRateLimit:{period:'86400s'},autoClose:'3600s'}},
 {displayName:'TripGuessr - public site unavailable',conditions:[threshold('At least two locations failing',`resource.type="uptime_url" AND metric.type="monitoring.googleapis.com/uptime_check/check_passed" AND metric.labels.check_id="${check.name.split('/').at(-1)}"`,{alignmentPeriod:'300s',perSeriesAligner:'ALIGN_NEXT_OLDER',crossSeriesReducer:'REDUCE_COUNT_FALSE'},'COMPARISON_GT',1,'300s')]},
 {displayName:'TripGuessr - server errors',conditions:[threshold('At least 3 HTTP 5xx in 5 minutes',`${native('run.googleapis.com/request_count')} AND metric.labels.response_code_class="5xx"`,sum5,'COMPARISON_GT',2)]},
 {displayName:'TripGuessr - request throttling',conditions:[threshold('At least 10 HTTP 429 in 5 minutes',`${native('run.googleapis.com/request_count')} AND metric.labels.response_code="429"`,sum5,'COMPARISON_GT',9)]},
 {displayName:'TripGuessr - application error',conditions:[{displayName:'Sanitized application error',conditionMatchedLog:{filter:`${logFilter} AND severity>=ERROR`}}],alertStrategy:{notificationRateLimit:{period:'900s'},autoClose:'3600s'}},
];
const oldPolicies=(await api(`${monitoring}/alertPolicies`)).alertPolicies||[],created=[];
for(const policy of policies){
 const body={...policy,combiner:'OR',enabled:true,notificationChannels:channels,documentation:{mimeType:'text/markdown',content:'Check the TripGuessr dashboard and sanitized logs. Never paste private trip links, cookies, user details, or photo data into incidents. Public uptime checks cover HTTPS/proxy/app reachability; database/storage problems require application traffic to surface.'},alertStrategy:policy.alertStrategy||{autoClose:'3600s'}};
 const old=oldPolicies.find(p=>p.displayName===body.displayName);
 created.push(old?await api(`https://monitoring.googleapis.com/v3/${old.name}`,'PATCH',{...body,name:old.name}):await api(`${monitoring}/alertPolicies`,'POST',body));
}
const query=(filter,aligner='ALIGN_SUM',reducer='REDUCE_SUM',groups=[],full=false)=>({timeSeriesFilter:{filter,aggregation:{alignmentPeriod:'300s',perSeriesAligner:aligner,crossSeriesReducer:reducer,groupByFields:groups}},...(full?{outputFullDuration:true}:{})});
const score=(title,filter)=>({title,scorecard:{timeSeriesQuery:query(filter,'ALIGN_SUM','REDUCE_SUM',[],true)}});
const chart=(title,filter,aligner='ALIGN_SUM',reducer='REDUCE_SUM',groups=[])=>({title,xyChart:{dataSets:[{timeSeriesQuery:query(filter,aligner,reducer,groups),plotType:'LINE'}],yAxis:{scale:'LINEAR'}}});
const tiles=[];const tile=(widget,x,y,width=12,height=8)=>tiles.push({widget,xPos:x,yPos:y,width,height});
const cf='https://dash.cloudflare.com/aecc316547dcfae9a564e9585c2e5e9b/workers/services/view/tripguessr-proxy/production/metrics';
// No private data or notification address is embedded in dashboard text.
// Use the account's own Cloudflare dashboard link in the operations guide.
const guide='https://github.com/wojtke/travelguesser/blob/main/docs/OBSERVABILITY.md';
tile({title:'Reading these numbers',text:{format:'MARKDOWN',content:`Counts include bots, our tests, retries and polling. Activity counters start when configured and are **not unique people**. Blank can mean no data, not zero. No visitor IDs or tracking cookies are added. [Operations guide](${guide}) · [Cloudflare Worker metrics](${cf})\n\n${channels.length?'Private email alerts are configured.':'No email destination is configured; incidents appear in this dashboard only.'}`}},0,0,24,5);
tile(score('HTTP requests (selected period)',native('run.googleapis.com/request_count')),0,5,6,4);
tile(score('HTTP 5xx (selected period)',`${native('run.googleapis.com/request_count')} AND metric.labels.response_code_class="5xx"`),6,5,6,4);
tile(score('App initializations (not visitors)',`${activity} AND metric.labels.activity="app_initializations"`),12,5,6,4);
tile(score('Trips created (selected period)',`${activity} AND metric.labels.activity="trips_created"`),18,5,6,4);
tile(chart('Requests per 5-minute interval by HTTP class',native('run.googleapis.com/request_count'),'ALIGN_SUM','REDUCE_SUM',['metric.labels.response_code_class']),0,9);
tile(chart('Successful activity requests per 5-minute interval',activity,'ALIGN_SUM','REDUCE_SUM',['metric.labels.activity']),12,9);
tile(chart('Worst revision p95 response time (ms)',native('run.googleapis.com/request_latencies'),'ALIGN_PERCENTILE_95','REDUCE_MAX'),0,17);
tile(chart('Worst revision p95 memory utilization',native('run.googleapis.com/container/memory/utilizations'),'ALIGN_PERCENTILE_95','REDUCE_MAX'),12,17);
tile(chart('Firestore document reads per 5-minute interval','resource.type="firestore_instance" AND metric.type="firestore.googleapis.com/document/read_count"'),0,25);
tile(chart('Stored photo bytes (provider reporting can lag)','resource.type="gcs_bucket" AND resource.labels.bucket_name="'+project+'-photos" AND metric.type="storage.googleapis.com/storage/total_bytes"','ALIGN_MEAN','REDUCE_SUM'),12,25);
tile({title:'Open incidents',incidentList:{policyNames:created.map(p=>p.name.split('/').slice(-2).join('/'))}},0,33,24,6);
tile({title:'Sanitized application warnings and errors',logsPanel:{filter:`${logFilter} AND severity>=WARNING`,resourceNames:[prefix]}},0,39,24,10);
const dashboard={displayName:'TripGuessr - traffic, health and activity',mosaicLayout:{columns:24,tiles}};
const dashboards=`https://monitoring.googleapis.com/v1/${prefix}/dashboards`,oldDashboard=(await api(dashboards)).dashboards?.find(d=>d.displayName===dashboard.displayName);
const saved=oldDashboard?await api(`https://monitoring.googleapis.com/v1/${oldDashboard.name}`,'PATCH',{...dashboard,name:oldDashboard.name,etag:(await api(`https://monitoring.googleapis.com/v1/${oldDashboard.name}`)).etag}):await api(dashboards,'POST',dashboard);
if(exclude){
 const recent=await api('https://logging.googleapis.com/v2/entries:list','POST',{resourceNames:[prefix],filter:`${logFilter} AND jsonPayload.event="request" AND timestamp>="${new Date(Date.now()-30*60e3).toISOString()}"`,pageSize:1,orderBy:'timestamp desc'});
 if(!recent.entries?.length)throw new Error('No recent structured request log found. Deploy and verify the new application before excluding raw logs.');
 const sink=await api(`${logging}/sinks/_Default`);
 const name='tripguessr-raw-request-logs';
 const exclusion={name,description:'Structured application logs and built-in metrics replace raw request URLs/IPs. Historical logs age out normally.',filter:`${base} AND log_id("run.googleapis.com/requests")`,disabled:false};
 await api(`${logging}/sinks/_Default?updateMask=exclusions`,'PATCH',{exclusions:[...(sink.exclusions||[]).filter(e=>e.name!==name),exclusion]});
}
console.log(JSON.stringify({dashboard:`https://console.cloud.google.com/monitoring/dashboards/builder/${saved.name.split('/').at(-1)}?project=${project}`,uptime:check.name,policies:created.map(p=>({name:p.name,title:p.displayName})),emailAlerts:channels.length>0,rawRequestLogsExcluded:exclude},null,2));
