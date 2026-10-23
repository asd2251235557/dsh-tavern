// A read-only session snapshot. Refresh never clears accepted presentation.
const EMPTY_STAGE_RUNTIME = Object.freeze({ data: null, scene: null, pending: false, error: "" });
function createStageRuntimeStore({ read, project, changed }) {
	let state = EMPTY_STAGE_RUNTIME, revision = 0, dirty = false, disposed = false, flight = null, request = null;
	function publish(next) { state = next; changed(); }
	async function drain() {
		while (dirty && !disposed) {
			dirty = false;
			const token = revision;
			request = new AbortController();
			try {
				const value = await read(request.signal);
				if (disposed || token !== revision) continue;
				const data = JSON.stringify(value) === JSON.stringify(state.data) ? state.data : value;
				const candidate = data === state.data ? state.scene : project(data);
				const scene = JSON.stringify(candidate) === JSON.stringify(state.scene) ? state.scene : candidate;
				publish({ data, scene, pending: false, error: "" });
			} catch (error) {
				if (!disposed && token === revision) publish({ ...state, pending: false, error: String(error.message || error) });
			}
		}
	}
	const store = {
		getSnapshot: () => state,
		refresh(reset = false) {
			if (disposed) return Promise.resolve();
			revision++; dirty = true;
			if (reset) { request?.abort(); state = EMPTY_STAGE_RUNTIME; }
			if (!state.pending) publish({ ...state, pending: true, error: "" });
			if (!flight) flight = Promise.resolve().then(drain).finally(() => { flight = null; if (dirty && !disposed) return store.refresh(); });
			return flight;
		},
		dispose() { disposed = true; dirty = false; revision++; request?.abort(); publish(EMPTY_STAGE_RUNTIME); }
	};
	return store;
}

// Native bindings own stores, not React mounts. Only open the selected session;
// keep previously opened sessions until removal, and retire replaced bindings.
function createStageRuntimeSessions({ read, project, watch }) {
	const records = new Map(), listeners = new Map();
	function notify(id) { for (const fn of listeners.get(id) || []) fn(); }
	function release(id) {
		const record = records.get(id);
		record.stop(); records.delete(id); record.store.dispose();
	}
	return {
		getSnapshot: id => records.get(id)?.store.getSnapshot() || EMPTY_STAGE_RUNTIME,
		subscribe(id, fn) {
			if (!listeners.has(id)) listeners.set(id, new Set());
			listeners.get(id).add(fn);
			return () => { const set = listeners.get(id); set.delete(fn); if (!set.size) listeners.delete(id); };
		},
		refresh: id => records.get(id)?.store.refresh(),
		start(sessions) {
			function reconcile() {
				const snapshot = sessions.list.getSnapshot(), rows = snapshot.byId || {};
				const selected = Object.values(rows).find(row => row.retainedBy?.mainView > 0)?.id || snapshot.current;
				for (const id of records.keys()) if (!rows[id] && id !== selected) release(id);
				const ids = new Set(records.keys());
				if (selected && rows[selected]?.origin !== "subagent") ids.add(selected);
				for (const id of ids) {
					const binding = sessions.binding(id), previous = records.get(id);
					if (previous?.binding === binding) continue;
					if (previous) release(id);
					if (!binding) continue;
					const store = createStageRuntimeStore({ read: signal => read(id, signal), project, changed: () => notify(id) });
					const record = { binding, store, stop() {} };
					records.set(id, record);
					record.stop = watch(id, binding, reset => store.refresh(reset));
					void store.refresh();
				}
			}
			const stop = sessions.list.subscribe(reconcile);
			reconcile();
			return () => { stop(); for (const id of records.keys()) release(id); };
		}
	};
}
