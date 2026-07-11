import { useDebugValue, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

/**
 * Build-time replacement for `use-sync-external-store/shim/with-selector.js`
 * (CJS-only; see use-sync-external-store-shim.ts for why). A faithful ESM port
 * of the official `useSyncExternalStoreWithSelector` over react >= 18's
 * built-in `useSyncExternalStore`: the selector is memoized against the last
 * snapshot/selection pair, and `isEqual` keeps referentially-stable selections.
 */
export function useSyncExternalStoreWithSelector<Snapshot, Selection>(
    subscribe: (onStoreChange: () => void) => () => void,
    getSnapshot: () => Snapshot,
    getServerSnapshot: undefined | null | (() => Snapshot),
    selector: (snapshot: Snapshot) => Selection,
    isEqual?: (a: Selection, b: Selection) => boolean,
): Selection {
    const instRef = useRef<{ hasValue: boolean; value: Selection | null } | null>(null);

    let inst: { hasValue: boolean; value: Selection | null };

    if (instRef.current === null) {
        inst = { hasValue: false, value: null };
        instRef.current = inst;
    } else {
        inst = instRef.current;
    }

    const [getSelection, getServerSelection] = useMemo(() => {
        let hasMemo = false;
        let memoizedSnapshot: Snapshot;
        let memoizedSelection: Selection;

        const memoizedSelector = (nextSnapshot: Snapshot): Selection => {
            if (!hasMemo) {
                hasMemo = true;
                memoizedSnapshot = nextSnapshot;

                const nextSelection = selector(nextSnapshot);

                if (isEqual !== undefined && inst.hasValue) {
                    const currentSelection = inst.value as Selection;

                    if (isEqual(currentSelection, nextSelection)) {
                        memoizedSelection = currentSelection;

                        return currentSelection;
                    }
                }

                memoizedSelection = nextSelection;

                return nextSelection;
            }

            const prevSnapshot = memoizedSnapshot;
            const prevSelection = memoizedSelection;

            if (Object.is(prevSnapshot, nextSnapshot)) {
                return prevSelection;
            }

            const nextSelection = selector(nextSnapshot);

            if (isEqual !== undefined && isEqual(prevSelection, nextSelection)) {
                memoizedSnapshot = nextSnapshot;

                return prevSelection;
            }

            memoizedSnapshot = nextSnapshot;
            memoizedSelection = nextSelection;

            return nextSelection;
        };

        const maybeGetServerSnapshot = getServerSnapshot === undefined ? null : getServerSnapshot;
        const getSnapshotWithSelector = () => memoizedSelector(getSnapshot());
        const getServerSnapshotWithSelector =
            maybeGetServerSnapshot === null ? undefined : () => memoizedSelector(maybeGetServerSnapshot());

        return [getSnapshotWithSelector, getServerSnapshotWithSelector];
    }, [getSnapshot, getServerSnapshot, selector, isEqual]);

    const value = useSyncExternalStore(subscribe, getSelection, getServerSelection);

    useEffect(() => {
        inst.hasValue = true;
        inst.value = value;
    }, [inst, value]);

    useDebugValue(value);

    return value;
}
