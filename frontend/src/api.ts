import type { Artifact, Chunk, Probe, Session, Thread, Turn, TurnSubmission } from "./types";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

type ApiErrorPayload = { detail?: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ApiErrorPayload;
    throw new Error(payload.detail ?? "The grill could not complete that step.");
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function createSession(
  rawExperience: string,
  note?: string,
): Promise<{ session_id: string; chunks: Chunk[] }> {
  return request("/api/session", {
    method: "POST",
    body: JSON.stringify({
      raw_experience: rawExperience,
      extra_sources: note?.trim()
        ? [{ source_type: "notes", source_name: "Supporting note", text: note }]
        : [],
    }),
  });
}

export async function readSession(sessionId: string): Promise<{
  restatement: string;
  probes: Probe[];
}> {
  return request(`/api/session/${sessionId}/read`, { method: "POST" });
}

export async function correctRestatement(sessionId: string, restatement: string): Promise<void> {
  await request(`/api/session/${sessionId}/read`, {
    method: "PATCH",
    body: JSON.stringify({ restatement }),
  });
}

export async function submitTurn(
  sessionId: string,
  payload: TurnSubmission,
): Promise<{ turn: Turn | null; done: boolean; thread: Thread }> {
  return request(`/api/session/${sessionId}/turn`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function createArtifact(
  sessionId: string,
): Promise<{ thread: Thread; artifact: Artifact }> {
  return request(`/api/session/${sessionId}/artifact`, { method: "POST" });
}

export async function getSession(sessionId: string): Promise<Session> {
  return request(`/api/session/${sessionId}`);
}

export async function getReplay(sessionId = "demo"): Promise<Session> {
  return request(`/api/session/${sessionId}/replay`);
}

export async function captureEvent(
  sessionId: string,
  type: "copy_artifact" | "export_md" | "flag_useless_question" | "delete_segment",
  payload: Record<string, unknown> = {},
): Promise<void> {
  await request(`/api/session/${sessionId}/event`, {
    method: "POST",
    body: JSON.stringify({ type, payload }),
  });
}
