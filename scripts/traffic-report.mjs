// PROJECT_ID=... node scripts/traffic-report.mjs [--hours 24]
// Reads only sanitized application logs and aggregate provider metrics.
import {accessToken} from './admin-cloud.mjs';
const project=process.env.PROJECT_ID, index=process.argv.indexOf('--hours');
const hours=index<0?24:Number(process.argv[index+1]);
if(!project||!Number.isFinite(hours)||hours<=0||hours>720)throw new Error('Set PROJECT_ID and choose --hours between 0 and 720.');
const token=accessToken(),end=new Date(),start=new Date(end-hours*36e5),prefix=`projects/${project}`;
async function api(url,body){const r=await fetch(url,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const j=await r.json();if(!r.ok)throw new Error(j.error?.message||`HTTP ${r.status}`);return j;}
const increment=(map,key,n=1)=>map[key]=(map[key]||0)+n;
const activity={},status={},routes={},hoursUTC={},warnings={};let total=0,entriesSeen=0,pageToken,truncated=false;
const latencies=[];
do{
 const data=await api('https://logging.googleapis.com/v2/entries:list',{resourceNames:[prefix],filter:`resource.type="cloud_run_revision" AND resource.labels.service_name="travelguesser" AND jsonPayload.component="tripguessr" AND timestamp>="${start.toISOString()}" AND timestamp<="${end.toISOString()}"`,orderBy:'timestamp desc',pageSize:1000,...(pageToken?{pageToken}:{})});
 for(const e of data.entries||[]){entriesSeen++;const p=e.jsonPayload||{};
  if(p.event==='request'){total++;increment(status,p.status);increment(routes,`${p.method} ${p.route}`);increment(hoursUTC,e.timestamp.slice(0,13));if(p.activity)increment(activity,p.activity);if(Number.isFinite(p.durationMs))latencies.push(p.durationMs);}
  else if(['runtime_warning','runtime_crash','upload_cleanup_failed'].includes(p.event))increment(warnings,`${p.event}: ${p.errorType||'Error'}`);
 }
 pageToken=data.nextPageToken;if(entriesSeen>=100000&&pageToken){truncated=true;break;}
}while(pageToken);
const url=new URL(`https://monitoring.googleapis.com/v3/${prefix}/timeSeries`);
for(const [k,v]of Object.entries({filter:'resource.type="cloud_run_revision" AND resource.labels.service_name="travelguesser" AND metric.type="run.googleapis.com/request_count"','interval.startTime':start.toISOString(),'interval.endTime':end.toISOString(),'aggregation.alignmentPeriod':'3600s','aggregation.perSeriesAligner':'ALIGN_SUM','aggregation.crossSeriesReducer':'REDUCE_SUM','aggregation.groupByFields':'metric.labels.response_code_class',pageSize:'1000'}))url.searchParams.set(k,v);
const native=await api(url),nativeStatus={};
for(const series of native.timeSeries||[])for(const point of series.points||[])increment(nativeStatus,series.metric.labels.response_code_class,Number(point.value.int64Value||0));
latencies.sort((a,b)=>a-b);
console.log(JSON.stringify({window:{startUTC:start.toISOString(),endUTC:end.toISOString()},providerRequestsByStatusClass:nativeStatus,sanitizedApplicationRequests:total,activityRequests:activity,status,routes,hoursUTC,warnings,latencyMs:{p50:latencies[Math.floor(latencies.length*.5)]??null,p95:latencies[Math.floor(latencies.length*.95)]??null},truncated,notes:['Requests and app initializations are not unique people. Bots, tests, polling, retries and resumes can count.','Sanitized activity starts with the observability deployment; provider metrics may lag a few minutes.','Cloud Run can reject requests before application logging; compare its built-in metrics.']},null,2));
