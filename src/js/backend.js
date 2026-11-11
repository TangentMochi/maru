const { invoke } = window.__TAURI__.core;

/** @returns {Promise<import("./request.js").RequestDef[] | null>} null until something has been saved. */
export const loadRequests = () => invoke("load_requests");

export const saveRequests = (requests) => invoke("save_requests", { requests });

/**
 * The session commands resolve to the state the HTTP session is in afterwards.
 * @returns {Promise<"off" | "active" | "paused">}
 */
export const sessionStatus = () => invoke("session_status");

export const startSession = () => invoke("start_session");

export const pauseSession = () => invoke("pause_session");

export const endSession = () => invoke("end_session");

/** Rejects with a message string when no response arrived (unreachable, timed out, cancelled). */
export const sendRequest = (id, request) => invoke("send_request", { id, request });

export const cancelRequest = (id) => invoke("cancel_request", { id });
