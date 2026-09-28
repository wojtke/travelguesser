// Log only a closed set of route names and diagnostic fields. Never copy a
// request, user object, URL, error message, header, or body into telemetry.
const exactRoutes = new Set(['/', '/create', '/privacy', '/terms', '/cookies', '/robots.txt', '/favicon.svg', '/api/health', '/api/session', '/api/auth/session', '/api/host/games', '/api/host/usage', '/api/host/locations/search', '/api/games']);
const methods = new Set(['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS']);
const actions = new Set(['join','guess','start','next','remove','leave','reveal','end']);

export function routeName(path) {
  if(exactRoutes.has(path))return path;
  if(path.startsWith('/assets/'))return '/assets/*';
  if(/^\/g\/[a-zA-Z0-9_-]{8,40}\/?$/.test(path))return '/g/:trip';
  if(/^\/g\/[a-zA-Z0-9_-]{8,40}\/live\/[a-zA-Z0-9_-]{8,40}\/?$/.test(path))return '/g/:trip/live/:lobby';
  if(/^\/api\/games\/[^/]+\/live\/[^/]+\/photos\/[^/]+\/?$/.test(path))return '/api/games/:trip/live/:lobby/photos/:round';
  const live=path.match(/^\/api\/games\/[^/]+\/live\/[^/]+(?:\/([^/]+))?\/?$/);
  if(live)return live[1]?(actions.has(live[1])?`/api/games/:trip/live/:lobby/${live[1]}`:'other'):'/api/games/:trip/live/:lobby';
  if(/^\/api\/games\/[^/]+\/photos\/[^/]+\/?$/.test(path))return '/api/games/:trip/photos/:round';
  const game=path.match(/^\/api\/games\/[^/]+(?:\/(join|round|guess|leaderboard|sharing|live))?\/?$/);
  if(game)return '/api/games/:trip'+(game[1]?`/${game[1]}`:'');
  return 'other';
}

export function isAppPage(path) {
  return ['/', '/create', '/privacy', '/terms', '/cookies', '/g/:trip', '/g/:trip/live/:lobby'].includes(routeName(path));
}

const activities = new Map([
  ['GET /api/session','app_initializations'],
  ['POST /api/auth/session','creator_signins'],
  ['POST /api/games','trips_created'],
  ['POST /api/games/:trip/join','solo_join_requests'],
  ['POST /api/games/:trip/guess','solo_guess_requests'],
  ['POST /api/games/:trip/live','live_lobbies_created'],
  ['POST /api/games/:trip/live/:lobby/join','live_join_requests'],
  ['POST /api/games/:trip/live/:lobby/guess','live_guess_requests'],
]);

export function errorDetails(error) {
  const names=new Set(['Error','TypeError','RangeError','SyntaxError','URIError','HttpError','MulterError','MaxListenersExceededWarning','DeprecationWarning']);
  const codes=new Set(['ECONNRESET','ECONNREFUSED','ETIMEDOUT','ENOTFOUND','ENOENT','EPIPE','ERR_STREAM_PREMATURE_CLOSE']);
  const stack=String(error?.stack||''), header=`${error?.name}: ${error?.message}`;
  const frames=(stack.startsWith(header)?stack.slice(header.length):'').split('\n').flatMap(line=>{
    // Only code locations below our server or dependencies; no first line,
    // dynamic function names, absolute paths, request values, or stack causes.
    const m=line.match(/(?:\/(server\/[a-z-]+\.js|node_modules\/[a-zA-Z0-9_@./-]+\.(?:js|cjs|mjs))|(node:[a-zA-Z0-9_/-]+)):(\d+):(\d+)\)?$/);
    return m?[`${m[1]||m[2]}:${m[3]}:${m[4]}`]:[];
  }).slice(0,8);
  return {errorType:names.has(error?.name)?error.name:'Error',...(codes.has(error?.code)?{errorCode:error.code}:{}),...(Number.isInteger(error?.code)&&error.code>=0&&error.code<=16?{rpcCode:error.code}:{}),...(frames.length?{frames}:{})};
}

export function writeLog(entry) { console.log(JSON.stringify({component:'tripguessr',...entry})); }

export function observeRequests(write=writeLog) {
  return (req,res,next)=>{
    const started=performance.now(), route=routeName(req.path), method=methods.has(req.method)?req.method:'OTHER';
    let logged=false;
    const finish=()=>{
      if(logged)return;logged=true;
      const status=res.writableFinished?res.statusCode:499;
      const activity=status>=200&&status<300?activities.get(`${method} ${route}`):undefined;
      write({event:'request',severity:status>=500?'ERROR':status===429||status===499?'WARNING':'INFO',route,method,status,durationMs:Math.round((performance.now()-started)*100)/100,...(activity?{activity}:{}),...res.locals.telemetryError});
    };
    res.once('finish',finish);res.once('close',finish);next();
  };
}
