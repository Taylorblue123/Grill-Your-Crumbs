import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Clipboard,
  Download,
  Eye,
  FileText,
  Flag,
  Lightbulb,
  MessageSquareText,
  Play,
  RotateCcw,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  captureEvent,
  correctRestatement,
  createArtifact,
  createSession,
  getReplay,
  getSession,
  readSession,
  submitTurn,
} from "./api";
import type {
  Artifact,
  Origin,
  Segment,
  Session,
  Thread,
  ThreadFact,
  TurnSubmission,
} from "./types";

type Mode = "live" | "replay";
type Screen = "intake" | "interview" | "reveal";
type ArtifactView = "resume" | "intro";

const SAMPLE_EXPERIENCE =
  "I helped rebuild onboarding for a student founder community and worked with the team to launch it.";
const SAMPLE_NOTE =
  "New members regularly abandoned the old seven-step form during identity setup.";

const ORIGIN_COPY: Record<
  Origin,
  { label: string; short: string; description: string; icon: typeof FileText }
> = {
  source: {
    label: "From your material",
    short: "Source",
    description: "This claim matches text you supplied before the interview.",
    icon: FileText,
  },
  grill: {
    label: "Unearthed in conversation",
    short: "Unearthed",
    description: "This detail came from one of your answers during the grill.",
    icon: Sparkles,
  },
  inferred: {
    label: "AI suggestion, check it",
    short: "Check",
    description: "This phrasing is not supported by a source or answer yet.",
    icon: CircleHelp,
  },
};

function blankThread(sessionId = ""): Thread {
  return {
    thread_id: "",
    session_id: sessionId,
    highlight: "",
    quantified_results: [],
    decisions: [],
    challenges: [],
    raw_new_facts: [],
  };
}

function App() {
  const [mode, setMode] = useState<Mode>("replay");
  const [screen, setScreen] = useState<Screen>("interview");
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [replayIndex, setReplayIndex] = useState(3);

  useEffect(() => {
    if (mode !== "replay") return;
    let active = true;
    setLoading(true);
    setError(null);
    getReplay()
      .then((result) => {
        if (!active) return;
        setSession(result);
        setReplayIndex(result.turns.length);
        setScreen("interview");
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Replay could not load.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mode]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  function chooseMode(nextMode: Mode) {
    if (nextMode === mode) return;
    setMode(nextMode);
    setError(null);
    if (nextMode === "live") {
      setSession(null);
      setScreen("intake");
      setLoading(false);
    }
  }

  async function startLive(rawExperience: string, note: string) {
    setLoading(true);
    setError(null);
    try {
      const created = await createSession(rawExperience, note);
      await readSession(created.session_id);
      const current = await getSession(created.session_id);
      setSession(current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The session could not start.");
    } finally {
      setLoading(false);
    }
  }

  async function beginInterview() {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      const next = await submitTurn(session.session_id, {});
      if (next.done && !next.turn) {
        await createArtifact(session.session_id);
        setSession(await getSession(session.session_id));
        setScreen("reveal");
      } else {
        setSession(await getSession(session.session_id));
        setScreen("interview");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The first question could not load.");
    } finally {
      setLoading(false);
    }
  }

  async function saveRestatement(restatement: string) {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      await correctRestatement(session.session_id, restatement);
      setSession(await getSession(session.session_id));
      setToast("Your correction is now the session's working read.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The correction could not be saved.");
    } finally {
      setLoading(false);
    }
  }

  function restartLiveSession() {
    setSession(null);
    setScreen("intake");
    setError(null);
  }

  async function answerTurn(payload: TurnSubmission) {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      const next = await submitTurn(session.session_id, payload);
      if (next.done) {
        await createArtifact(session.session_id);
      }
      setSession(await getSession(session.session_id));
      if (next.done) setScreen("reveal");
      if (payload.flagged_useless) setToast("Question flagged. That feedback is saved.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Your answer could not be saved.");
    } finally {
      setLoading(false);
    }
  }

  async function buildResult() {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      if (mode === "live") {
        await createArtifact(session.session_id);
        setSession(await getSession(session.session_id));
      }
      setScreen("reveal");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The artifact could not be built.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-shell">
      <TopBar mode={mode} onModeChange={chooseMode} />
      <Progress screen={screen} />

      <main id="main-content" className={screen === "reveal" ? "main main-reveal" : "main"}>
        {error ? (
          <div className="error-banner" role="alert">
            <CircleHelp size={20} aria-hidden="true" />
            <span>{error}</span>
            <button className="icon-button" onClick={() => setError(null)} aria-label="Dismiss error">
              <X size={18} />
            </button>
          </div>
        ) : null}

        {loading && !session ? <LoadingState /> : null}
        {!loading && mode === "live" && screen === "intake" && !session ? (
          <IntakeScreen onStart={startLive} />
        ) : null}
        {session && screen === "intake" ? (
          <ReadScreen
            session={session}
            onContinue={beginInterview}
            onCorrect={saveRestatement}
            onStartOver={restartLiveSession}
            loading={loading}
          />
        ) : null}
        {session && screen === "interview" ? (
          <InterviewScreen
            mode={mode}
            session={session}
            loading={loading}
            replayIndex={replayIndex}
            onReplayIndexChange={setReplayIndex}
            onAnswer={answerTurn}
            onBuild={buildResult}
          />
        ) : null}
        {session && screen === "reveal" && session.artifact ? (
          <RevealScreen
            session={session}
            mode={mode}
            onBack={() => setScreen("interview")}
            onNotify={setToast}
          />
        ) : null}
      </main>

      <div className="toast" role="status" aria-live="polite" data-visible={Boolean(toast)}>
        <CheckCircle2 size={18} aria-hidden="true" />
        <span>{toast}</span>
      </div>
    </div>
  );
}

function TopBar({ mode, onModeChange }: { mode: Mode; onModeChange: (mode: Mode) => void }) {
  return (
    <header className="topbar">
      <a href="#main-content" className="brand" aria-label="Grill Your Crumbs home">
        <span className="brand-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span>Grill Your Crumbs</span>
      </a>
      <div className="mode-switch" role="group" aria-label="Demo mode">
        <button
          data-active={mode === "replay"}
          aria-pressed={mode === "replay"}
          onClick={() => onModeChange("replay")}
        >
          <Play size={15} aria-hidden="true" />
          Replay
        </button>
        <button
          data-active={mode === "live"}
          aria-pressed={mode === "live"}
          onClick={() => onModeChange("live")}
        >
          <span className="live-dot" aria-hidden="true" />
          Live
        </button>
      </div>
      <div className="demo-status">
        <Check size={15} aria-hidden="true" />
        Local demo ready
      </div>
    </header>
  );
}

function Progress({ screen }: { screen: Screen }) {
  const current = screen === "intake" ? 0 : screen === "interview" ? 1 : 2;
  const labels = ["Add and check crumbs", "Grill", "See the proof"];
  return (
    <nav className="progress" aria-label="Session progress">
      {labels.map((label, index) => (
        <div className="progress-step" data-state={index === current ? "active" : index < current ? "done" : "upcoming"} key={label}>
          <span className="progress-number">{index < current ? <Check size={13} /> : index + 1}</span>
          <span>{label}</span>
        </div>
      ))}
    </nav>
  );
}

function IntakeScreen({ onStart }: { onStart: (raw: string, note: string) => Promise<void> }) {
  const [raw, setRaw] = useState("");
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const isReady = raw.trim().length >= 10;

  return (
    <section className="intake-screen">
      <div className="intake-heading">
        <div className="step-symbol" aria-hidden="true">
          <Upload size={22} />
        </div>
        <h1>Give us the version that feels too plain.</h1>
        <p>
          Paste one rough experience. We will ask focused questions, then return a stronger version
          with every claim labeled by where it came from.
        </p>
      </div>

      <form
        className="intake-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (isReady) void onStart(raw, note);
        }}
      >
        <div className="field-heading">
          <label htmlFor="experience">Your rough experience</label>
          <button
            className="text-button"
            type="button"
            onClick={() => {
              setRaw(SAMPLE_EXPERIENCE);
              setNote(SAMPLE_NOTE);
              setShowNote(true);
            }}
          >
            Use a sample
          </button>
        </div>
        <textarea
          id="experience"
          value={raw}
          onChange={(event) => setRaw(event.target.value)}
          placeholder="I worked on onboarding for our community and helped launch a new flow..."
          rows={7}
        />
        <div className="input-footer">
          <span>{raw.trim().length} characters</span>
          <span>One paragraph is enough</span>
        </div>

        {showNote ? (
          <div className="supporting-source">
            <div className="field-heading">
              <label htmlFor="note">Optional supporting note</label>
              <button className="text-button muted-action" type="button" onClick={() => setShowNote(false)}>
                Remove
              </button>
            </div>
            <textarea
              id="note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Paste a note, project detail, or existing bullet."
              rows={3}
            />
          </div>
        ) : (
          <button className="secondary-button add-source" type="button" onClick={() => setShowNote(true)}>
            <FileText size={17} aria-hidden="true" />
            Add a supporting note
          </button>
        )}

        <button className="primary-button start-button" type="submit" disabled={!isReady}>
          Read my crumbs
          <ArrowRight size={18} aria-hidden="true" />
        </button>
      </form>
      <p className="privacy-note">Stored as local JSON for this demo. No database is involved.</p>
    </section>
  );
}

function ReadScreen({
  session,
  onContinue,
  onCorrect,
  onStartOver,
  loading,
}: {
  session: Session;
  onContinue: () => void;
  onCorrect: (restatement: string) => Promise<void>;
  onStartOver: () => void;
  loading: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [restatement, setRestatement] = useState(session.restatement ?? "");

  return (
    <section className="read-screen">
      <header className="screen-heading compact-heading">
        <span className="screen-kicker">Before we ask</span>
        <h1>Here is what we think happened.</h1>
        <p>Correct the read now, before a mistaken assumption compounds across the interview.</p>
      </header>

      <div className="read-layout">
        <div className="restatement-panel">
          <MessageSquareText size={22} aria-hidden="true" />
          {editing ? (
            <div className="correction-editor">
              <label htmlFor="restatement">Correct our understanding</label>
              <textarea
                id="restatement"
                value={restatement}
                onChange={(event) => setRestatement(event.target.value)}
                rows={4}
              />
              <div>
                <button className="text-button muted-action" type="button" onClick={() => setEditing(false)}>
                  Cancel
                </button>
                <button
                  className="primary-button"
                  type="button"
                  disabled={loading || restatement.trim().length < 10}
                  onClick={() => void onCorrect(restatement).then(() => setEditing(false))}
                >
                  Save correction
                </button>
              </div>
            </div>
          ) : (
            <>
              <blockquote>{session.restatement}</blockquote>
              <button className="text-button" type="button" onClick={() => setEditing(true)}>
                <RotateCcw size={15} aria-hidden="true" />
                This is not quite right
              </button>
            </>
          )}
        </div>

        <div className="probe-list">
          <h2>The three places most likely to hide value</h2>
          {session.probes.map((probe, index) => (
            <article className="probe-row" key={probe.point}>
              <span className="probe-index">{index + 1}</span>
              <div>
                <h3>{probe.point}</h3>
                <p>{probe.why_valuable}</p>
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="screen-actions">
        <button className="secondary-button" onClick={onStartOver}>
          Start over
        </button>
        <button className="primary-button" onClick={onContinue} disabled={loading}>
          {loading ? "Preparing question..." : "Start the grill"}
          <ArrowRight size={18} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

function InterviewScreen({
  mode,
  session,
  loading,
  replayIndex,
  onReplayIndexChange,
  onAnswer,
  onBuild,
}: {
  mode: Mode;
  session: Session;
  loading: boolean;
  replayIndex: number;
  onReplayIndexChange: (index: number) => void;
  onAnswer: (payload: TurnSubmission) => void;
  onBuild: () => void;
}) {
  const visibleTurns = mode === "replay" ? session.turns.slice(0, replayIndex) : session.turns;
  const visibleIds = new Set(visibleTurns.filter((turn) => turn.status === "answered").map((turn) => turn.turn_id));
  const visibleThread = filterThread(session.thread, visibleIds);
  const currentTurn = mode === "live" ? session.turns.at(-1) : null;
  const answerCount = session.turns.filter((turn) => turn.status === "answered").length;

  return (
    <section className="interview-screen">
      <header className="interview-header">
        <div>
          <span className="screen-kicker">{mode === "replay" ? "Prepared session" : "Live session"}</span>
          <h1>{mode === "replay" ? "Watch the hidden value appear." : "One question at a time."}</h1>
        </div>
        <div className="round-meter" aria-label={`${visibleTurns.length} of 5 rounds`}>
          <span>{mode === "replay" ? `${visibleTurns.length} moments shown` : `Round ${Math.min(session.turns.length, 5)} of 5`}</span>
          <div className="meter-track">
            <span style={{ width: `${Math.max(10, (visibleTurns.length / (mode === "replay" ? session.turns.length : 5)) * 100)}%` }} />
          </div>
        </div>
      </header>

      <div className="interview-layout">
        <div className="conversation-panel">
          {mode === "replay" ? (
            <ReplayConversation
              turns={visibleTurns}
              index={replayIndex}
              total={session.turns.length}
              onIndexChange={onReplayIndexChange}
            />
          ) : (
            <LiveConversation turns={session.turns} loading={loading} onAnswer={onAnswer} />
          )}
        </div>
        <ThreadPanel thread={visibleThread} />
      </div>

      <div className="interview-footer">
        <p>
          {mode === "replay"
            ? "The gold facts did not exist in the starting material."
            : `${answerCount} answer${answerCount === 1 ? "" : "s"} saved to this thread.`}
        </p>
        <button className="reveal-button" onClick={onBuild} disabled={mode === "live" && answerCount === 0}>
          <Eye size={18} aria-hidden="true" />
          Reveal the before and after
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

function ReplayConversation({
  turns,
  index,
  total,
  onIndexChange,
}: {
  turns: Session["turns"];
  index: number;
  total: number;
  onIndexChange: (value: number) => void;
}) {
  return (
    <div className="replay-conversation">
      <div className="replay-controls">
        <span>
          Replay moment {index} of {total}
        </span>
        <div>
          <button className="icon-button bordered" onClick={() => onIndexChange(Math.max(1, index - 1))} disabled={index <= 1} aria-label="Previous replay moment">
            <ArrowLeft size={17} />
          </button>
          <button className="icon-button bordered" onClick={() => onIndexChange(Math.min(total, index + 1))} disabled={index >= total} aria-label="Next replay moment">
            <ArrowRight size={17} />
          </button>
        </div>
      </div>
      <div className="turn-list">
        {turns.map((turn) => (
          <article className="turn-block" key={turn.turn_id}>
            <div className="turn-meta">
              <span>Question {turn.round}</span>
              <span className="reason-label">
                <Lightbulb size={14} aria-hidden="true" /> Why this question
              </span>
            </div>
            <h2>{turn.question}</h2>
            <p className="question-reason">{turn.why_asked}</p>
            {turn.user_answer ? (
              <div className="answer-block">
                <span>Your answer</span>
                <p>{turn.user_answer}</p>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}

function LiveConversation({
  turns,
  loading,
  onAnswer,
}: {
  turns: Session["turns"];
  loading: boolean;
  onAnswer: (payload: TurnSubmission) => void;
}) {
  const current = turns.at(-1);
  const [answer, setAnswer] = useState("");

  useEffect(() => setAnswer(""), [current?.turn_id]);

  if (!current) return <LoadingState />;

  if (current.status !== "pending") {
    return (
      <div className="interview-complete">
        <CheckCircle2 size={28} aria-hidden="true" />
        <h2>The interview is ready to reveal.</h2>
        <p>The useful rounds are saved. Open the before-and-after proof when you are ready.</p>
      </div>
    );
  }

  return (
    <div className="live-conversation">
      {turns.slice(0, -1).map((turn) => (
        <div className="past-turn" key={turn.turn_id}>
          <span>Q{turn.round}</span>
          <p>{turn.question}</p>
          <strong>{turn.status === "answered" ? turn.user_answer : turn.status === "skipped" ? "Skipped" : "Flagged as unhelpful"}</strong>
        </div>
      ))}
      <article className="current-question">
        <div className="turn-meta">
          <span>Question {current.round}</span>
          <span className="reason-label">
            <Lightbulb size={14} aria-hidden="true" /> Why this question
          </span>
        </div>
        <h2>{current.question}</h2>
        <p className="question-reason">{current.why_asked}</p>
        <button className="guess-button" type="button" onClick={() => setAnswer(current.guessed_answer.replace("For example: ", ""))}>
          <Sparkles size={15} aria-hidden="true" />
          <span>
            <strong>Use a starting point</strong>
            {current.guessed_answer}
          </span>
        </button>
        <label htmlFor="turn-answer">Your answer</label>
        <textarea
          id="turn-answer"
          rows={4}
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          placeholder="Add the detail only you would know..."
        />
        <div className="answer-actions">
          <div>
            <button className="quiet-button" onClick={() => onAnswer({ skipped: true })} disabled={loading}>
              Skip question
            </button>
            <button className="quiet-button" onClick={() => onAnswer({ flagged_useless: true })} disabled={loading}>
              <Flag size={15} aria-hidden="true" />
              Not useful
            </button>
          </div>
          <button className="primary-button" onClick={() => onAnswer({ answer })} disabled={loading || answer.trim().length < 2}>
            {loading ? "Saving answer..." : "Save and continue"}
            <ArrowRight size={17} aria-hidden="true" />
          </button>
        </div>
      </article>
    </div>
  );
}

function ThreadPanel({ thread }: { thread: Thread }) {
  const groups: Array<{ label: string; facts: ThreadFact[] }> = [
    { label: "Measured results", facts: thread.quantified_results },
    { label: "Decisions", facts: thread.decisions },
    { label: "Constraints", facts: thread.challenges },
    { label: "Other discoveries", facts: thread.raw_new_facts },
  ];
  const count = groups.reduce((sum, group) => sum + group.facts.length, 0);
  return (
    <aside className="thread-panel" aria-label="Growing interview thread">
      <div className="thread-heading">
        <div>
          <Sparkles size={17} aria-hidden="true" />
          <h2>Your thread</h2>
        </div>
        <span>{count} new</span>
      </div>
      {count === 0 ? (
        <div className="thread-empty">
          <MessageSquareText size={22} aria-hidden="true" />
          <p>Your answers will become reusable facts here.</p>
        </div>
      ) : (
        <div className="thread-groups">
          {groups.map((group) =>
            group.facts.length ? (
              <section key={group.label}>
                <h3>{group.label}</h3>
                {group.facts.map((fact) => (
                  <p key={`${fact.turn_id}-${fact.text}`}>
                    <span aria-hidden="true" />
                    {fact.text}
                  </p>
                ))}
              </section>
            ) : null,
          )}
        </div>
      )}
      <div className="thread-note">
        <Check size={15} aria-hidden="true" />
        Every fact points back to an answer.
      </div>
    </aside>
  );
}

function RevealScreen({
  session,
  mode,
  onBack,
  onNotify,
}: {
  session: Session;
  mode: Mode;
  onBack: () => void;
  onNotify: (message: string) => void;
}) {
  const artifact = session.artifact as Artifact;
  const [view, setView] = useState<ArtifactView>("resume");
  const [selected, setSelected] = useState<Segment | null>(null);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const segmentGroups = view === "resume" ? artifact.resume_bullets : [artifact.self_intro];
  const segments = segmentGroups.flat();
  let flatIndex = 0;
  const visibleGroups = segmentGroups.map((group) =>
    group
      .map((segment) => ({ segment, index: flatIndex++ }))
      .filter(({ index }) => !removed.has(`${view}-${index}`)),
  );
  const visibleSegments = visibleGroups.flat().map(({ segment }) => segment);
  const surfaceStats = visibleSegments.reduce(
    (counts, segment) => ({ ...counts, [segment.origin]: counts[segment.origin] + 1 }),
    { source: 0, grill: 0, inferred: 0 } as Record<Origin, number>,
  );

  async function copyArtifact() {
    const text =
      view === "resume"
        ? visibleGroups
            .filter((group) => group.length)
            .map((group) => `• ${group.map(({ segment }) => segment.text).join(" ")}`)
            .join("\n")
        : visibleSegments.map((segment) => segment.text).join(" ");
    await navigator.clipboard.writeText(text);
    await captureEvent(session.session_id, "copy_artifact", { surface: view });
    onNotify("Artifact copied with provenance-free formatting.");
  }

  async function exportMarkdown() {
    const markdown = artifactToMarkdown(session, artifact, removed);
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "grill-your-crumbs-artifact.md";
    link.click();
    URL.revokeObjectURL(url);
    await captureEvent(session.session_id, "export_md", { surface: view });
    onNotify("Markdown exported.");
  }

  async function removeSegment(segment: Segment, index: number) {
    const next = new Set(removed);
    next.add(`${view}-${index}`);
    setRemoved(next);
    setSelected(null);
    await captureEvent(session.session_id, "delete_segment", {
      origin: segment.origin,
      text: segment.text,
    });
    onNotify("Unsupported suggestion removed and logged.");
  }

  return (
    <section className="reveal-screen">
      <header className="reveal-header">
        <button className="text-button back-button" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true" />
          Back to {mode === "replay" ? "replay" : "interview"}
        </button>
        <div>
          <span className="screen-kicker">The proof</span>
          <h1>The missing details are now visible.</h1>
          <p>Color, labels, and references separate what you brought from what the grill uncovered.</p>
        </div>
        <div className="artifact-tabs" role="group" aria-label="Artifact type">
          <button
            data-active={view === "resume"}
            aria-pressed={view === "resume"}
            onClick={() => setView("resume")}
          >
            Resume bullet
          </button>
          <button
            data-active={view === "intro"}
            aria-pressed={view === "intro"}
            onClick={() => setView("intro")}
          >
            Self introduction
          </button>
        </div>
      </header>

      <ProvenanceLegend />

      <div className="comparison">
        <article className="before-panel">
          <div className="comparison-heading">
            <span>Before</span>
            <small>1 source, no interview</small>
          </div>
          <p>{session.chunks[0].text}</p>
          {session.chunks.slice(1).map((chunk) => (
            <div className="source-chip" key={chunk.id}>
              <FileText size={14} aria-hidden="true" />
              {chunk.source_name}
            </div>
          ))}
        </article>

        <article className="after-panel">
          <div className="comparison-heading">
            <span>After</span>
            <small>{surfaceStats.grill} facts uncovered</small>
          </div>
          <div className="artifact-copy" aria-label="Generated artifact with provenance">
            {visibleGroups.map((group, groupIndex) =>
              group.length ? (
                <div className={view === "resume" ? "artifact-bullet" : "artifact-intro"} key={groupIndex}>
                  {view === "resume" ? <span className="bullet-mark" aria-hidden="true">•</span> : null}
                  <div>
                    {group.map(({ segment, index }) => {
                      const copy = ORIGIN_COPY[segment.origin];
                      const Icon = copy.icon;
                      return (
                        <button
                          className={`segment segment-${segment.origin}`}
                          key={`${segment.origin}-${index}-${segment.text}`}
                          onClick={() => setSelected(segment)}
                          aria-label={`${copy.label}: ${segment.text}`}
                        >
                          <span className="segment-label">
                            <Icon size={12} aria-hidden="true" /> {copy.short}
                          </span>
                          {segment.text}{" "}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null,
            )}
          </div>
          {selected ? (
            <SegmentEvidence
              segment={selected}
              session={session}
              onClose={() => setSelected(null)}
              onRemove={(segment) => {
                const index = segments.indexOf(segment);
                void removeSegment(segment, index);
              }}
            />
          ) : (
            <p className="evidence-hint">
              <Eye size={16} aria-hidden="true" /> Select any highlighted phrase to inspect its evidence.
            </p>
          )}
        </article>
      </div>

      <div className="proof-stats" aria-label="Artifact provenance totals">
        <span><strong>{surfaceStats.source}</strong> source segments</span>
        <span><strong>{surfaceStats.grill}</strong> uncovered segments</span>
        <span><strong>{surfaceStats.inferred}</strong> suggestions to check</span>
      </div>

      <div className="reveal-actions">
        <button className="secondary-button" onClick={() => void exportMarkdown()}>
          <Download size={17} aria-hidden="true" /> Export Markdown
        </button>
        <button className="primary-button" onClick={() => void copyArtifact()}>
          <Clipboard size={17} aria-hidden="true" /> Copy artifact
        </button>
      </div>
    </section>
  );
}

function ProvenanceLegend() {
  return (
    <div className="legend" aria-label="Provenance legend">
      {(Object.keys(ORIGIN_COPY) as Origin[]).map((origin) => {
        const item = ORIGIN_COPY[origin];
        const Icon = item.icon;
        return (
          <span className={`legend-${origin}`} key={origin}>
            <Icon size={15} aria-hidden="true" />
            {item.label}
          </span>
        );
      })}
    </div>
  );
}

function SegmentEvidence({
  segment,
  session,
  onClose,
  onRemove,
}: {
  segment: Segment;
  session: Session;
  onClose: () => void;
  onRemove: (segment: Segment) => void;
}) {
  const copy = ORIGIN_COPY[segment.origin];
  const source = segment.origin === "source" ? session.chunks.find((chunk) => segment.ref.includes(chunk.id)) : null;
  const turn = segment.origin === "grill" ? session.turns.find((item) => item.turn_id === segment.turn_id) : null;
  return (
    <div className={`evidence-panel evidence-${segment.origin}`} role="region" aria-label="Segment evidence">
      <div className="evidence-title">
        <div>
          <strong>{copy.label}</strong>
          <span>{segment.verified ? "Verified by code" : "Needs your confirmation"}</span>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close evidence panel">
          <X size={17} />
        </button>
      </div>
      <p>{source?.text ?? turn?.user_answer ?? copy.description}</p>
      {source ? <small>Source: {source.source_name}</small> : null}
      {turn ? <small>Answer to question {turn.round}: {turn.question}</small> : null}
      {segment.origin === "inferred" ? (
        <button className="danger-text-button" onClick={() => onRemove(segment)}>
          Remove unsupported suggestion
        </button>
      ) : null}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="loading-state" role="status">
      <span />
      <div>
        <strong>Reading the evidence</strong>
        <p>Finding what is known and what only you can answer.</p>
      </div>
    </div>
  );
}

function filterThread(thread: Thread, visibleIds: Set<string>): Thread {
  const keep = (fact: ThreadFact) => visibleIds.has(fact.turn_id);
  return {
    ...blankThread(thread.session_id),
    ...thread,
    quantified_results: thread.quantified_results.filter(keep),
    decisions: thread.decisions.filter(keep),
    challenges: thread.challenges.filter(keep),
    raw_new_facts: thread.raw_new_facts.filter(keep),
  };
}

function artifactToMarkdown(session: Session, artifact: Artifact, removed: Set<string>): string {
  let resumeIndex = 0;
  const bullet = artifact.resume_bullets
    .map((segments) => {
      const visible = segments.filter(() => !removed.has(`resume-${resumeIndex++}`));
      return `- ${visible.map((segment) => segment.text).join(" ")}`;
    })
    .join("\n");
  const intro = artifact.self_intro
    .filter((_, index) => !removed.has(`intro-${index}`))
    .map((segment) => segment.text)
    .join(" ");
  return `# Grill Your Crumbs artifact\n\n## Starting point\n\n${session.chunks[0].text}\n\n## Resume\n\n${bullet}\n\n## Self introduction\n\n${intro}\n`;
}

export default App;
