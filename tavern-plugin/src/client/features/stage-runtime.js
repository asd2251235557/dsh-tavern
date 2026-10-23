// Resolve static presentation once per accepted snapshot, not in each stage view.
function stageRuntimeScene(data) {
	return { background: data.background || data.card.imageUrl || "", backdrop: Boolean(data.background),
		figures: data.stage.figures.map(figure => ({ name: figure.speaker, url: tavernCastImage(data, figure.speaker, figure.emotion) })) };
}

// Shared with the cast editor; image selection is not a second scene projection.
function tavernCastImage(data, name, emotion, preferAvatar) {
	const character = tavernCastCharacter(data.cast, name);
	const sprites = character ? character.sprites || {} : {};
	const sprite = sprites[emotion] || sprites.neutral || Object.values(sprites)[0] || "";
	const avatar = character && (character.avatars || {})[emotion] || character && character.avatarUrl || (name === data.card.name ? data.card.imageUrl : "");
	return preferAvatar ? avatar || sprite : sprite || avatar;
}

function watchStageRuntime(sessionId, binding, refresh) {
	let authority = null, running = binding.session.getSnapshot().running;
	const wake = () => refresh();
	const selection = liveTavernView.select(sessionId, [["chatId"], ["card", "path"], ["suppressedDshTurns"], ["regeneratedDshTurns"], ["settlementTurn"], ["updatedAt"]]);
	const stops = [selection.subscribe(() => {
		const view = selection.getSnapshot().view;
		if (!view) return;
		// An adopted regeneration replaces text, not the scene's authority domain.
		const withdrawn = (view.suppressedDshTurns || []).filter(turn => !Object.values(view.regeneratedDshTurns || {}).includes(turn));
		const next = JSON.stringify([view.chatId, view.card?.path, withdrawn]);
		const reset = authority !== null && authority !== next;
		authority = next; refresh(reset);
	}), binding.session.subscribe(() => {
		const next = binding.session.getSnapshot().running;
		if (next !== running) { running = next; wake(); }
	}), tavernCoordination.subscribe(sessionId, wake), tavernSessionSignals.subscribe(sessionId, "cast", wake, undefined, wake)];
	for (const event of ["dsh-tavern-settings-changed", "dsh-tavern-card-stage-changed", "focus"]) window.addEventListener(event, wake);
	// Reconcile missed notifications without creating a director job or writing history.
	const timer = window.setInterval(() => { if (!document.hidden) wake(); }, 5000);
	return () => {
		stops.forEach(stop => stop()); window.clearInterval(timer);
		for (const event of ["dsh-tavern-settings-changed", "dsh-tavern-card-stage-changed", "focus"]) window.removeEventListener(event, wake);
	};
}
const tavernStageRuntime = createStageRuntimeSessions({
	read: (id, signal) => rpc("castStage", { count: 5 }, id, { signal }), project: stageRuntimeScene, watch: watchStageRuntime
});
function useTavernStageRuntime(sessionId) {
	const subscribe = React.useCallback(fn => tavernStageRuntime.subscribe(sessionId, fn), [sessionId]);
	const snapshot = React.useCallback(() => tavernStageRuntime.getSnapshot(sessionId), [sessionId]);
	return React.useSyncExternalStore(subscribe, snapshot, snapshot);
}
