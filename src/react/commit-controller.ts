/**
 * The commit/rebuild brain of the editor island, factored out of React so the
 * decisions are exhaustively testable without a live EditorView:
 *
 * - Commits (doc.toJSON()) fire on trailing debounce, blur, and flush().
 * - A last-committed guard absorbs the RJSF onChange echo: an external value
 *   equal to the last-committed JSON is ignored; a differing one asks the
 *   island to rebuild EditorState (which must NOT fire a commit).
 */

/** A serialized ProseMirror document (doc.toJSON()). */
export type DocJson = Record<string, unknown>;

export interface CommitPolicy {
    /** Trailing debounce for transaction-driven commits. Default 400. */
    debounceMs?: number;
    /** Whether blur commits immediately. Default true. */
    onBlur?: boolean;
}

export type ExternalValueDecision = 'ignore' | 'rebuild';

export class CommitController {
    private readonly debounceMs: number;
    private readonly commitOnBlur: boolean;
    private lastCommitted: string;
    private dirty = false;
    private timer: ReturnType<typeof setTimeout> | null = null;

    constructor(
        private readonly getDoc: () => DocJson,
        private readonly deliver: (doc: DocJson) => void,
        policy: CommitPolicy = {},
        initialValue?: DocJson | null,
    ) {
        this.debounceMs = policy.debounceMs ?? 400;
        this.commitOnBlur = policy.onBlur ?? true;
        this.lastCommitted = JSON.stringify(initialValue ?? null);
    }

    /** A doc-changing transaction landed: restart the trailing debounce. */
    noteChange(): void {
        this.dirty = true;

        if (this.timer !== null) {
            clearTimeout(this.timer);
        }

        this.timer = setTimeout(() => this.flush(), this.debounceMs);
    }

    /** Blur commits immediately (unless the policy opts out). */
    noteBlur(): void {
        if (this.commitOnBlur) {
            this.flush();
        }
    }

    /** Commit synchronously when dirty; a clean flush is a no-op. */
    flush(): void {
        this.clearTimer();

        if (!this.dirty) {
            return;
        }

        this.dirty = false;
        const doc = this.getDoc();
        this.lastCommitted = JSON.stringify(doc ?? null);
        this.deliver(doc);
    }

    /**
     * The last-committed guard: equal to what we last committed (the RJSF
     * onChange echo) ⇒ ignore; different ⇒ the island must rebuild.
     */
    receiveExternalValue(value: DocJson | null | undefined): ExternalValueDecision {
        return JSON.stringify(value ?? null) === this.lastCommitted ? 'ignore' : 'rebuild';
    }

    /**
     * The island rebuilt EditorState from an external value. Resets dirt and
     * any pending debounce — a rebuild never fires a commit — and re-seeds the
     * guard so the rebuilt value's own echo is absorbed.
     */
    noteRebuilt(value: DocJson | null | undefined): void {
        this.clearTimer();
        this.dirty = false;
        this.lastCommitted = JSON.stringify(value ?? null);
    }

    get isDirty(): boolean {
        return this.dirty;
    }

    dispose(): void {
        this.clearTimer();
        this.dirty = false;
    }

    private clearTimer(): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }
}
