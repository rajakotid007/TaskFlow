import { getTask } from '../src/services/readModels.js';

/** Serialized task read model, as sent to the operator UI. */
export async function readModelJson(taskId: number): Promise<string> {
  return JSON.stringify(await getTask(taskId));
}
