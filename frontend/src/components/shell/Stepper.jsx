import { useDispatch, useStore } from '../../store/StoreContext.jsx';

const SCREENS = ['landing', 'dash', 'opps', 'setup', 'wb', 'done'];
const STEPS = [
  { name: 'setup', label: '投喂' },
  { name: 'wb', label: '拷问' },
  { name: 'done', label: '成果' },
];

export default function Stepper() {
  const { screen } = useStore();
  const dispatch = useDispatch();
  const cur = SCREENS.indexOf(screen);

  return (
    <nav className="stepper">
      <button type="button" className="step" title="回工作区" onClick={() => dispatch({ type: 'go', screen: 'dash' })}>
        <b>⌂</b>
        工作区
      </button>
      <span className="sep" />
      {STEPS.map((s, i) => {
        const idx = SCREENS.indexOf(s.name);
        const cls = idx === cur ? 'on' : (idx < cur ? 'done' : '');
        return (
          <span key={s.name} style={{ display: 'contents' }}>
            <button type="button" className={`step ${cls}`} onClick={() => dispatch({ type: 'go', screen: s.name })}>
              <b>{idx < cur ? '✓' : i + 1}</b>
              {s.label}
            </button>
            {i < 2 && <span className="sep" />}
          </span>
        );
      })}
    </nav>
  );
}
