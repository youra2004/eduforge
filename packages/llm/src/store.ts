import { llmRuns, type Db, type NewLLMRun } from '@eduforge/db';

/** Where llm_runs rows go. The Drizzle store is the real one; tests may use an in-memory one. */
export interface LLMRunStore {
  insert(run: NewLLMRun): Promise<string>;
}

export class DrizzleLLMRunStore implements LLMRunStore {
  constructor(private readonly db: Db) {}

  async insert(run: NewLLMRun): Promise<string> {
    const [row] = await this.db.insert(llmRuns).values(run).returning({ id: llmRuns.id });
    if (!row) throw new Error('llm_runs insert returned no row');
    return row.id;
  }
}
