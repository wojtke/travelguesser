export const defaultSettings = {
  mode: 'solo',
  timerMode: 'none',
  timeLimitSeconds: 0,
  afterFirstLockSeconds: 15,
  nextRoundControl: 'host',
  shufflePhotos: false,
};
export function SecondsInput({ label, value, onChange, id }) {
  const valid = Number.isInteger(value) && value >= 1 && value <= 3600;
  return (
    <label htmlFor={id}>
      {label}
      <div className="seconds-input">
        <input
          aria-label={`${label} slider`}
          type="range"
          min="1"
          max="3600"
          step="1"
          value={valid ? value : 1}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <input
          id={id}
          type="number"
          min="1"
          max="3600"
          step="1"
          value={Number.isNaN(value) ? '' : value}
          onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))}
          aria-invalid={!valid}
        />
        <span>seconds</span>
      </div>
      <small>1–3600 seconds</small>
    </label>
  );
}
export default function GameSettings({ value, onChange, showMode = true }) {
  const timerMode = value.timerMode ?? (value.timeLimitSeconds ? 'fixed' : 'none');
  return (
    <fieldset className="game-settings panel" id="game-options">
      <legend>Game options</legend>
      {showMode && (
        <label>
          Play mode
          <select
            value={value.mode}
            onChange={(e) => {
              const mode = e.target.value;
              onChange({
                ...value,
                mode,
                ...(mode === 'solo' && timerMode === 'afterFirstLock'
                  ? { timerMode: 'fixed', timeLimitSeconds: 60 }
                  : mode === 'live' && timerMode === 'none'
                    ? { timerMode: 'fixed', timeLimitSeconds: 60 }
                    : {}),
              });
            }}
          >
            <option value="solo">Play at your own pace</option>
            <option value="live">Live game with a lobby</option>
          </select>
        </label>
      )}
      <label>
        Round timer
        <select
          value={timerMode}
          onChange={(e) =>
            onChange({
              ...value,
              timerMode: e.target.value,
              timeLimitSeconds: e.target.value === 'fixed' ? value.timeLimitSeconds || 60 : 0,
            })
          }
        >
          <option value="none">No time limit</option>
          <option value="fixed">Time per photo</option>
          {value.mode === 'live' && (
            <option value="afterFirstLock">Start timer after first confirmed guess</option>
          )}
        </select>
      </label>
      {timerMode === 'fixed' && (
        <SecondsInput
          id="round-seconds"
          label="Time per photo"
          value={value.timeLimitSeconds}
          onChange={(timeLimitSeconds) => onChange({ ...value, timeLimitSeconds })}
        />
      )}
      {timerMode === 'afterFirstLock' && (
        <>
          <SecondsInput
            id="first-lock-seconds"
            label="Time after first confirmation"
            value={value.afterFirstLockSeconds ?? 15}
            onChange={(afterFirstLockSeconds) => onChange({ ...value, afterFirstLockSeconds })}
          />
          <small>
            No timer runs until someone confirms. Everyone else then has this long to finish.
          </small>
        </>
      )}
      {value.mode === 'live' && (
        <>
          <label>
            Who can start the next round?
            <select
              value={value.nextRoundControl || 'host'}
              onChange={(e) => onChange({ ...value, nextRoundControl: e.target.value })}
            >
              <option value="host">Host only</option>
              <option value="anyPlayer">Any active player</option>
            </select>
          </label>
          <small>
            The host starts the first round and can choose to watch or play in the lobby. At
            timeout, each player’s latest saved pin counts.
          </small>
        </>
      )}
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={value.shufflePhotos}
          onChange={(e) => onChange({ ...value, shufflePhotos: e.target.checked })}
        />
        Shuffle photo order
      </label>
    </fieldset>
  );
}
