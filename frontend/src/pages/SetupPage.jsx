/* ② 作战板先行（原投喂页）。
   一个问题都不问：三项配置塌缩成一句话里的三个下拉，系统直接把方案摆出来。 */
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import TopBar from '../components/shell/TopBar';
import Screen from '../components/shell/Screen';
import Stepper from '../components/shell/Stepper';
import SlotMenu from '../components/setup/SlotMenu';
import PlanBoard from '../components/setup/PlanBoard';
import MaterialUploader from '../components/common/MaterialUploader';
import BackendChip from '../components/common/BackendChip';
import { useSession } from '../state/SessionContext';
import { useCrumbLibrary } from '../state/CrumbLibraryContext';
import { ROUTES } from '../routes';

const OUTPUT_DESCS = [
  '针对这个 JD 的 EXPERIENCE 段落',
  '第一人称，长一点，不用对着 JD',
  '口语，面试开场用',
  '放在个人网站上的项目页',
];

const PROMISES = [
  <>
    每题先给<b>猜测答案</b>，点头就行
  </>,
  <>
    任何一轮都能<b>撤回</b>，稿子跟着回退
  </>,
  <>问得烂就点「这问题没意义」</>,
  <>
    JD 里你确实没有的，<b>不会替你编</b>
  </>,
];

export default function SetupPage() {
  const navigate = useNavigate();
  const { state, target, activeFacts, actions } = useSession();
  const { byId } = useCrumbLibrary();

  const targetOptions = useMemo(
    () =>
      state.targets
        .filter((t) => !t.entryOnly)
        .map((t) => ({
          id: t.id,
          label: t.title,
          desc: `${t.org} · ${t.reqs.length} 条要求`,
        }))
        .concat([{ id: '__none', label: '先不设目标', desc: '只做通用打磨，提问全走通用维度' }]),
    [state.targets],
  );
  const outputOptions = useMemo(
    () => state.goals.map((g, i) => ({ id: `g${i}`, label: g, desc: OUTPUT_DESCS[i] })),
    [state.goals],
  );
  const baseOptions = useMemo(
    () => state.bases.map((b) => ({ id: b.id, label: b.label, desc: b.desc })),
    [state.bases],
  );

  const outputLabel = state.goals[Number(state.outputId.slice(1))] || state.goals[0] || '';
  const uploadingBase = state.baseId === 'b2';

  return (
    <Screen name="setup" title="作战板">
      <TopBar nav={<Stepper current={ROUTES.setup} />}>
        <BackendChip />
        <button type="button" className="gbtn" onClick={() => navigate(ROUTES.dashboard)}>
          ← 回工作区
        </button>
      </TopBar>

      <div className="scroll">
        <div className="setup wide">
          <div className="kick2">
            {target ? `从「机会」页点了「${target.title} · 去补缺口」之后` : '从工作区点了「开一场新的 Grill」之后'}
          </div>
          <h1>
            我已经配好了。
            <br />
            下面<em>每一处都能改</em>。
          </h1>
          <p className="lede">
            一个问题都不问。三项配置就在下面这句话里——<b>句子本身就是表单</b>。
            你一个字都不用打：底子来自你已有的简历和材料库。
          </p>

          <p className="sentence" data-testid="config-sentence">
            为{' '}
            <SlotMenu
              label="目标"
              options={targetOptions}
              value={state.targetId || '__none'}
              onPick={(id) => actions.setTarget(id === '__none' ? null : id)}
            />{' '}
            组一份{' '}
            <SlotMenu
              label="产出物"
              options={outputOptions}
              value={state.outputId}
              onPick={actions.setOutput}
            />
            ， 底子用{' '}
            <SlotMenu label="底稿" options={baseOptions} value={state.baseId} onPick={actions.setBase} />。
          </p>

          {/* 「上传一份新的」是设计稿里唯一一个上传入口 —— 选中它才展开，
              不另造第二条输入通道。这条路径是真后端。 */}
          {uploadingBase ? (
            <section
              className="blk"
              data-testid="setup-upload"
              style={{ marginTop: 20 }}
              aria-label="上传一份新的简历"
            >
              <div className="blab">
                上传一份新的 <i>上传后它会变成材料库里的一条 crumb，不另造输入通道</i>
              </div>
              <MaterialUploader />
            </section>
          ) : null}

          <div style={{ marginTop: 22 }}>
            <PlanBoard
              plan={state.plan}
              planOn={state.planOn}
              planRounds={state.planRounds}
              target={target}
              activeFacts={activeFacts}
              outputLabel={outputLabel}
              crumbById={byId}
              onToggle={actions.togglePlan}
              onBump={actions.bumpPlan}
              onOnlyFirst={actions.onlyFirst}
              onStart={() => {
                actions.startPlan();
                navigate(ROUTES.workbench);
              }}
            />
          </div>

          <div className="promise" style={{ marginTop: 22 }}>
            {PROMISES.map((node, index) => (
              <span className="pm" key={index}>
                <em aria-hidden="true">✓</em>
                {node}
              </span>
            ))}
          </div>
        </div>
      </div>
    </Screen>
  );
}
