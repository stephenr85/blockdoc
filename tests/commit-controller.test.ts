import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommitController } from '../src/react/commit-controller';
import type { DocJson } from '../src/react/commit-controller';

const docA: DocJson = { type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'a' } }] };
const docB: DocJson = { type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'b' } }] };

function makeController(policy?: ConstructorParameters<typeof CommitController>[2], initial?: DocJson | null) {
    let current: DocJson = docA;
    const deliver = vi.fn();
    const controller = new CommitController(() => current, deliver, policy, initial);

    return {
        controller,
        deliver,
        setDoc: (doc: DocJson) => {
            current = doc;
        },
    };
}

describe('CommitController', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('fires exactly one commit after a burst of changes (trailing debounce)', () => {
        const { controller, deliver } = makeController();

        for (let i = 0; i < 25; i++) {
            controller.noteChange();
            vi.advanceTimersByTime(100);
        }

        expect(deliver).not.toHaveBeenCalled();

        vi.advanceTimersByTime(400);

        expect(deliver).toHaveBeenCalledTimes(1);
        expect(deliver).toHaveBeenCalledWith(docA);
    });

    it('honors a configured debounce interval', () => {
        const { controller, deliver } = makeController({ debounceMs: 50 });

        controller.noteChange();
        vi.advanceTimersByTime(49);
        expect(deliver).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(deliver).toHaveBeenCalledTimes(1);
    });

    it('commits immediately on blur and cancels the pending debounce', () => {
        const { controller, deliver } = makeController();

        controller.noteChange();
        controller.noteBlur();

        expect(deliver).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(1000);
        expect(deliver).toHaveBeenCalledTimes(1);
    });

    it('does not commit on blur when the policy opts out', () => {
        const { controller, deliver } = makeController({ onBlur: false });

        controller.noteChange();
        controller.noteBlur();

        expect(deliver).not.toHaveBeenCalled();

        vi.advanceTimersByTime(400);
        expect(deliver).toHaveBeenCalledTimes(1);
    });

    it('flush commits synchronously when dirty; a clean flush is a no-op', () => {
        const { controller, deliver } = makeController();

        controller.flush();
        expect(deliver).not.toHaveBeenCalled();

        controller.noteChange();
        controller.flush();
        expect(deliver).toHaveBeenCalledTimes(1);

        controller.flush();
        expect(deliver).toHaveBeenCalledTimes(1);
    });

    it('ignores the onChange echo of the last-committed value', () => {
        const { controller } = makeController();

        controller.noteChange();
        controller.flush();

        const echo = JSON.parse(JSON.stringify(docA)) as DocJson;
        expect(controller.receiveExternalValue(echo)).toBe('ignore');
    });

    it('ignores the initializing value before any commit', () => {
        const { controller } = makeController({}, docA);

        expect(controller.receiveExternalValue(docA)).toBe('ignore');
        expect(controller.receiveExternalValue(null)).toBe('rebuild');
    });

    it('treats null and undefined initial values alike', () => {
        const { controller } = makeController({}, null);

        expect(controller.receiveExternalValue(undefined)).toBe('ignore');
        expect(controller.receiveExternalValue(null)).toBe('ignore');
    });

    it('asks for a rebuild on a genuinely external value', () => {
        const { controller } = makeController({}, docA);

        expect(controller.receiveExternalValue(docB)).toBe('rebuild');
    });

    it('noteRebuilt absorbs the rebuild value without committing and drops pending dirt', () => {
        const { controller, deliver } = makeController({}, docA);

        controller.noteChange();
        controller.noteRebuilt(docB);

        vi.advanceTimersByTime(1000);
        expect(deliver).not.toHaveBeenCalled();

        expect(controller.receiveExternalValue(docB)).toBe('ignore');
        expect(controller.isDirty).toBe(false);
    });

    it('dispose cancels any pending commit', () => {
        const { controller, deliver } = makeController();

        controller.noteChange();
        controller.dispose();

        vi.advanceTimersByTime(1000);
        expect(deliver).not.toHaveBeenCalled();
    });
});
