export const defaultSettings = {
  mode: 'solo',
  timerMode: 'none',
  timeLimitSeconds: 0,
  afterFirstLockSeconds: 15,
  nextRoundControl: 'host',
  shufflePhotos: false,
};
const sliderMax = 1000;
const logMaxSeconds = Math.log(3600);
const sliderPosition = (seconds) => (Math.log(seconds) / logMaxSeconds) * sliderMax;

export function SecondsInput({ label, value, onChange, id, description }) {
  const valid = Number.isInteger(value) && value >= 1 && value <= 3600;
  const seconds = valid ? value : 1;
  const position = sliderPosition(seconds);
  return (
    <div className="seconds-field">
      <div className="seconds-heading">
        <label htmlFor={id}>{label}</label>
        <div className="seconds-value">
          <input
            id={id}
            type="number"
            min="1"
            max="3600"
            step="1"
            required
            value={Number.isNaN(value) ? '' : value}
            onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))}
            aria-invalid={!valid}
            aria-describedby={`${id}-hint`}
          />
          <span>seconds</span>
        </div>
      </div>
      <div className="seconds-track">
        <input
          aria-label={`${label} slider`}
          aria-valuemin={1}
          aria-valuemax={3600}
          aria-valuenow={seconds}
          aria-valuetext={`${seconds} ${seconds === 1 ? 'second' : 'seconds'}`}
          aria-describedby={`${id}-hint`}
          type="range"
          min="0"
          max={sliderMax}
          step="1"
          value={position}
          style={{ '--timer-progress': `${position / 10}%` }}
          onChange={(e) =>
            onChange(Math.round(Math.exp((Number(e.target.value) / sliderMax) * logMaxSeconds)))
          }
          onKeyDown={(e) => {
            const delta = {
              ArrowRight: 1,
              ArrowUp: 1,
              ArrowLeft: -1,
              ArrowDown: -1,
              PageUp: 60,
              PageDown: -60,
            }[e.key];
            if (delta !== undefined || e.key === 'Home' || e.key === 'End') {
              e.preventDefault();
              onChange(
                e.key === 'Home'
                  ? 1
                  : e.key === 'End'
                    ? 3600
                    : Math.max(1, Math.min(3600, seconds + delta)),
              );
            }
          }}
        />
        <div className="seconds-scale" aria-hidden="true">
          {[
            [1, '1s'],
            [10, '10s'],
            [60, '1m'],
            [600, '10m'],
            [3600, '1h'],
          ].map(([time, text]) => (
            <span key={time} style={{ left: `${sliderPosition(time) / 10}%` }}>
              {text}
            </span>
          ))}
        </div>
      </div>
      <small id={`${id}-hint`}>
        {description || '1–3,600 seconds. Type an exact value above.'}
      </small>
    </div>
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
            <option value="afterFirstLock">After first confirmed guess</option>
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
        <SecondsInput
          id="first-lock-seconds"
          label="Time after first confirmation"
          value={value.afterFirstLockSeconds ?? 15}
          onChange={(afterFirstLockSeconds) => onChange({ ...value, afterFirstLockSeconds })}
          description="No timer runs until someone confirms. Everyone else then has this long to finish."
        />
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
          <small className="game-settings-note">
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
