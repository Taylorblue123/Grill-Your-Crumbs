export type SourceType =
  | "raw_experience"
  | "resume"
  | "repo"
  | "linkedin"
  | "portfolio"
  | "notes"
  | "diary"
  | "social";

export type Chunk = {
  id: string;
  source_type: SourceType;
  source_name: string;
  text: string;
};

export type Probe = {
  point: string;
  why_valuable: string;
};

export type TurnStatus = "pending" | "answered" | "skipped" | "flagged_useless";

export type Turn = {
  turn_id: string;
  round: number;
  question: string;
  why_asked: string;
  guessed_answer: string;
  user_answer: string | null;
  status: TurnStatus;
};

export type TurnSubmission = {
  answer?: string;
  skipped?: boolean;
  flagged_useless?: boolean;
};

export type ThreadFact = {
  text: string;
  turn_id: string;
};

export type Thread = {
  thread_id: string;
  session_id: string;
  highlight: string;
  quantified_results: ThreadFact[];
  decisions: ThreadFact[];
  challenges: ThreadFact[];
  raw_new_facts: ThreadFact[];
};

export type Origin = "source" | "grill" | "inferred";

export type Segment = {
  text: string;
  origin: Origin;
  ref: string[];
  turn_id: string | null;
  verified: boolean;
};

export type Artifact = {
  artifact_id: string;
  resume_bullets: Segment[][];
  self_intro: Segment[];
  stats: {
    n_source: number;
    n_grill: number;
    n_inferred: number;
  };
};

export type TimelineEvent = {
  type: string;
  at: string;
  payload: Record<string, unknown>;
};

export type Session = {
  session_id: string;
  created_at: string;
  restatement: string | null;
  probes: Probe[];
  chunks: Chunk[];
  turns: Turn[];
  thread: Thread;
  artifact: Artifact | null;
  timeline?: TimelineEvent[];
};
