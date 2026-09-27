export const defaultSettings = { mode:'solo',timeLimitSeconds:0,shufflePhotos:false };
export default function GameSettings({value,onChange,showMode=true}) {
  return <fieldset className="game-settings panel"><legend>Game options</legend>
    {showMode&&<label>Play mode<select value={value.mode} onChange={e=>onChange({...value,mode:e.target.value,timeLimitSeconds:e.target.value==='live'&&value.timeLimitSeconds===0?60:value.timeLimitSeconds})}><option value="solo">Play at your own pace</option><option value="live">Live game with a lobby</option></select><small>{value.mode==='live'?'Everyone sees the same photo. You start each round and reveal results together.':'Friends play independently whenever they open the link.'}</small></label>}
    <label>Time per photo<select value={value.timeLimitSeconds} onChange={e=>onChange({...value,timeLimitSeconds:Number(e.target.value)})}>{[0,15,30,60,90,120,180,300].map(t=><option key={t} value={t}>{t===0?'No time limit':t<60?`${t} seconds`:`${t/60} minute${t===60?'':'s'}`}</option>)}</select><small>Unsubmitted guesses score 0 when time runs out.</small></label>
    <label className="checkbox-label"><input type="checkbox" checked={value.shufflePhotos} onChange={e=>onChange({...value,shufflePhotos:e.target.checked})}/> Shuffle photo order</label>
  </fieldset>;
}
