import { NavLink, useNavigate } from 'react-router-dom';
import { ROUTES } from '../../routes';

const STEPS = [
  { label: '投喂', path: ROUTES.setup },
  { label: '拷问', path: ROUTES.workbench },
  { label: '成果', path: ROUTES.done },
];

/** 投喂 → 拷问 → 成果：随时知道自己在第几步、还剩几步。 */
export default function Stepper({ current }) {
  const navigate = useNavigate();
  const currentIndex = STEPS.findIndex((s) => s.path === current);

  return (
    <nav className="stepper" aria-label="流程步骤">
      <button type="button" className="step" onClick={() => navigate(ROUTES.dashboard)} title="回工作区">
        <b aria-hidden="true">⌂</b>
        工作区
      </button>
      <span className="sep" aria-hidden="true" />
      {STEPS.map((step, index) => {
        const done = currentIndex > index;
        const on = currentIndex === index;
        return (
          <span key={step.path} style={{ display: 'contents' }}>
            <NavLink
              to={step.path}
              className={`step ${on ? 'on' : done ? 'done' : ''}`}
              aria-current={on ? 'step' : undefined}
            >
              <b aria-hidden="true">{done ? '✓' : index + 1}</b>
              {step.label}
            </NavLink>
            {index < STEPS.length - 1 ? <span className="sep" aria-hidden="true" /> : null}
          </span>
        );
      })}
    </nav>
  );
}
