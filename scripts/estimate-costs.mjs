// Planning model, USD before tax, rates checked 2026-09-27. See docs/COSTS-AND-LIMITS.md.
// Counts include the host's browser. Active tabs only; hidden/finished tabs stop polling.
const sessions=Number(process.argv[2]||1000),storedTrips=Number(process.argv[3]||100);
if(!Number.isFinite(sessions)||sessions<0||!Number.isFinite(storedTrips)||storedTrips<0)throw Error('Use nonnegative counts: node scripts/estimate-costs.mjs [playerSessionsPerMonth] [storedTrips]');
const requests=sessions*650,readOps=sessions*650,egressGiB=sessions*12/1024,photoGiB=storedTrips*10*.5/1024;
const costs={
  photoStorage:photoGiB*.023,
  photoReads:sessions*20/1000*.0004,
  egress:egressGiB*.12,
  firestoreReads:Math.max(0,readOps-50000*30)/100000*.039,
  // Evenly spread sessions assumed; free daily quotas cannot be carried forward.
  // Hypothetical paid plan at 3 ms Worker CPU/request; current deployment stays Free.
  cloudflare:requests/30>100000?5+Math.max(0,requests-10e6)/1e6*.30+Math.max(0,requests*3-30e6)/1e6*.02:0,
};
const compute=secondsPerRequest=>{
  const seconds=requests*secondsPerRequest;
  return Math.max(0,seconds*.0000336-4.32)+Math.max(0,seconds*.0000035-.90)+Math.max(0,requests-2e6)/1e6*.40;
};
const other=Object.values(costs).reduce((sum,cost)=>sum+cost,0),round=n=>Number(n.toFixed(2));
console.log(JSON.stringify({assumptions:{playerSessionsPerMonth:sessions,storedTrips,minutesPerSession:30,photosPerTrip:10,averagePhotoMiB:.5,transferMiBPerSession:12,allocatedSecondsPerRequest:[.1,.3],days:30},usage:{requests,reads:readOps,averageDailyRequests:Math.ceil(requests/30),egressGiB:round(egressGiB),photoGiB:round(photoGiB)},costUSD:Object.fromEntries(Object.entries(costs).map(([k,v])=>[k,round(v)])),cloudRunUSD:[round(compute(.1)),round(compute(.3))],modelTotalUSD:[round(other+compute(.1)),round(other+compute(.3))],exclusions:'Domain, tax, builds/artifacts, log overages, photo writes, Firestore writes/storage overages, cold starts, abuse, and extra replays/downloads. Free quotas assumed otherwise unused. See report.'},null,2));
