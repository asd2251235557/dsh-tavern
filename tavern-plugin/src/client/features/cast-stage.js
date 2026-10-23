		function TavernStageFigure(props) {
			const [failed, setFailed] = React.useState("");
			const h = React.createElement;
			const url = failed === props.url ? "" : props.url;
			return h("div", { className: "dsh-tavern-stage-figure" + (props.dim ? " is-dim" : ""), "data-speaker": props.name },
				h("div", { className: "dsh-tavern-stage-figure-body" },
					url ? h("img", { key: url, src: url, alt: props.name, onError: function () { setFailed(props.url); } })
						: h("span", { className: "dsh-tavern-stage-figure-letter", style: { "--dsh-cast-hue": tavernCastHue(props.name) } }, Array.from(props.name)[0] || "?")));
		}

		/** One stage frame: who is on stage at this beat, and the text box. */
		function TavernStageScene(props) {
			const h = React.createElement;
			const data = props.data, beats = props.beats, index = props.index;
			const beat = beats[index] || null;
			const scene = props.scene;
			return h("div", { ref: props.sceneRef, className: "dsh-tavern-stage-scene", onClick: props.onAdvance },
				h("div", { className: "dsh-tavern-stage-backdrop" + (scene.backdrop ? " is-scene" : ""), style: scene.background ? { "--dsh-stage-backdrop": "url(\"" + scene.background + "\")" } : undefined }),
				h("div", { className: "dsh-tavern-stage-figures" }, scene.figures.map(function (figure) {
					const name = figure.name;
					const speaker = beat && tavernCastCharacter(data.cast, beat.speaker);
					const speaking = beat && (speaker ? speaker.name : beat.speaker) === name;
					return h(TavernStageFigure, { key: name, name: name, url: figure.url, dim: beat && beat.kind === "line" && !speaking });
				})),
				beat ? h("div", { className: "dsh-tavern-stage-textbox" },
					beat.kind === "line" ? h("div", { className: "dsh-tavern-stage-name", style: { "--dsh-cast-hue": tavernCastHue(beat.speaker) } }, beat.speaker,
						TAVERN_CAST_EMOTIONS[beat.emotion] && beat.emotion !== "neutral" ? h("span", { className: "dsh-tavern-cast-emotion" }, TAVERN_CAST_EMOTIONS[beat.emotion]) : null) : null,
					h("div", { key: index, className: "dsh-tavern-stage-text" + (beat.kind === "narration" ? " is-narration" : "") }, beat.text),
					props.footer || null)
					: h("div", { className: "dsh-tavern-stage-textbox is-empty" }, props.empty || "还没有可以演出的正文"));
		}

		/** The stage data as plugins see it (tavernUi.getStage). */
		function tavernStagePublicData(data) {
			return { enabled: data.enabled !== false, player: data.player, card: data.card, background: data.background || "", music: data.music, stage: data.stage, characters: data.cast || [], turns: data.turns || [] };
		}

		// The look of the stage: Tavern's own, or a plugin's registerStageView; remembered per browser.
		// With no choice made, a plugin view is used: installing one is asking for it.
		function useTavernStageView(sessionId) {
			return useTavernPluginViewChoice(tavernUiExtensions.stageViews(), "dsh-tavern-stage-view", sessionId);
		}

		function TavernStageViewSwitch(props) {
			if (!props.choice.views.length) return null;
			return React.createElement(TavernPluginViewSwitch, { choice: props.choice, label: "舞台样式", className: "dsh-tavern-stage-view-switch" });
		}

		function TavernStagePluginScene(props) {
			const rendered = props.view.render(props.input);
			return rendered === null || rendered === undefined ? props.fallback : rendered;
		}

		/** The scene in the chosen look; a plugin view that fails or returns null shows Tavern's own. */
		function TavernStageSceneView(props) {
			const builtin = React.createElement(TavernStageScene, props);
			if (!props.view) return builtin;
			const beat = props.beats[props.index] || null;
			const input = { gameId: props.sessionId, stage: tavernStagePublicData(props.data), beats: props.beats, index: props.index, beat: beat,
				fullscreen: true, advance: props.onAdvance, footer: props.footer || null };
			return React.createElement(tavernPluginBoundary(), { key: props.view.key, owner: props.view.owner, fallback: builtin },
				React.createElement(TavernStagePluginScene, { view: props.view, input: input, fallback: builtin }));
		}

		// Opening/refreshing restores the page, not its one-shots. Only explicit visits
		// or a newly arriving body can play; director notifications keep the same visit.
		function useTavernStageReader(data, sessionId) {
			const latest = data && data.turns[data.turns.length - 1];
			const key = latest ? latest.key : "";
			const beats = React.useMemo(function () { return latest ? latest.pages.map(function (page) { return Object.assign({ turn: latest.turn }, page); }) : []; }, [key, latest && JSON.stringify(latest.pages)]);
			const [position, setPosition] = React.useState({ key: "", index: 0, visit: 0, mode: "refresh" });
			const current = position.key === key && position.sessionId === sessionId ? position : { key: key, index: 0, visit: position.visit, mode: "refresh" };
			React.useEffect(function () {
				setPosition(function (old) { return old.key === key && old.sessionId === sessionId ? old : { sessionId: sessionId, key: key, index: 0, visit: old.visit + 1, mode: old.key && old.sessionId === sessionId ? "live" : "refresh" }; });
			}, [key, sessionId]);
			function setIndex(value, mode) {
				setPosition(function (old) {
					const index = Math.max(0, Math.min(beats.length - 1, typeof value === "function" ? value(current.index) : value));
					if (index === current.index && mode !== "skip") return old;
					return { sessionId: sessionId, key: key, index: index, visit: old.visit + 1, mode: mode || "page" };
				});
			}
			return { beats: beats, index: current.index, setIndex: setIndex, turn: latest && latest.turn,
				visit: key + ":" + current.visit, mode: current.mode, events: latest ? latest.performances : [] };
		}

		function playTavernStagePerformance(root, event, id) {
			if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
			const target = event.op === "screen.play" ? root : Array.from(root.querySelectorAll("[data-speaker]")).find(function (node) { return node.dataset.speaker === event.actor; });
			if (!target) return null;
			const frames = event.op === "screen.play" ? ["none", "translateX(-3px)", "translateX(3px)", "translateX(-2px)", "none"]
				: event.motion === "nod" ? ["none", "translateY(2%)", "none", "translateY(1%)", "none"] : ["none", "translateY(-6%)", "none"];
			return target.animate(frames.map(function (transform) { return { transform: transform }; }), { id: "stage:" + id, duration: event.op === "screen.play" ? 450 : 650, easing: "ease-in-out" });
		}

		// Reading the stage aloud: on by default once voicing is on; the button turns it off for this browser.
		const TAVERN_STAGE_READ_KEY = "dsh-tavern-stage-read";
		function useTavernStageReading() {
			const speech = useTavernSpeechSettings();
			const [reading, setReading] = React.useState(function () { try { return window.localStorage.getItem(TAVERN_STAGE_READ_KEY) !== "0"; } catch (_) { return true; } });
			function toggle() {
				const next = !reading;
				setReading(next);
				if (!next) tavernSpeech.stop();
				try { window.localStorage.setItem(TAVERN_STAGE_READ_KEY, next ? "1" : "0"); } catch (_) {}
			}
			React.useEffect(function () { return function () { tavernSpeech.stop(); }; }, []);
			const available = Boolean(speech && speech.enabled);
			return { available: available, on: available && reading, toggle: toggle };
		}
		function tavernBeatSpeech(sessionId, beat) {
			return beat.kind === "line" ? { sessionId: sessionId, speaker: beat.speaker, text: (beat.quotes || []).join(" ") || beat.text, emotion: beat.emotion }
				: { sessionId: sessionId, text: beat.text, narration: true };
		}
		function TavernStageReadButton(props) {
			if (!props.reading.available) return null;
			return React.createElement("button", { type: "button", className: props.reading.on ? "is-on" : "", "aria-pressed": props.reading.on, onClick: props.reading.toggle }, "朗读");
		}

		function TavernStageFullscreen(props) {
			const h = React.createElement;
			const reader = props.reader;
			const [auto, setAuto] = React.useState(false);
			const reading = useTavernStageReading();
			const [draft, setDraft] = React.useState("");
			const [sending, setSending] = React.useState(false);
			const atEnd = reader.index >= reader.beats.length - 1;
			function step(delta) { reader.setIndex(function (value) { return Math.max(0, Math.min(reader.beats.length - 1, value + delta)); }); }
			React.useEffect(function () {
				function onKey(event) {
					if (event.target && /^(INPUT|TEXTAREA)$/.test(event.target.tagName)) return;
					if (event.key === "Escape") { event.stopPropagation(); props.onClose(); }
					else if (event.key === "ArrowRight" || event.key === " " || event.key === "Enter") { event.preventDefault(); step(1); }
					else if (event.key === "ArrowLeft") { event.preventDefault(); step(-1); }
				}
				document.addEventListener("keydown", onKey, true);
				return function () { document.removeEventListener("keydown", onKey, true); };
			}, [reader.beats.length, reader.index, reader.turn]);
			// Each beat is read when reading is on; auto play turns the page when it was heard, or after a time by its length.
			React.useEffect(function () {
				const beat = reader.beats[reader.index];
				let active = true, timer = null;
				const delay = Math.max(1500, Math.min(10000, 400 + 70 * Array.from(beat ? beat.text : "").length));
				const turn = function (wait) { if (active && auto && !atEnd) timer = window.setTimeout(function () { step(1); }, wait); };
				if (reading.on && beat && reader.mode !== "skip") tavernSpeech.speak(tavernBeatSpeech(props.sessionId, beat)).then(function (heard) { turn(heard ? 400 : delay); });
				else turn(delay);
				return function () { active = false; if (timer !== null) window.clearTimeout(timer); };
			}, [auto, reader.index, reader.turn, reader.beats, reader.mode, atEnd, reading.on, props.sessionId]);
			async function send(event) {
				event.preventDefault();
				const text = draft.trim();
				if (!text || sending) return;
				setSending(true);
				try { await props.onSubmit(text); setDraft(""); }
				catch (error) { tavernErrorHub.report("舞台发送", error); }
				finally { setSending(false); }
			}
			const footer = h("div", { className: "dsh-tavern-stage-controls", onClick: function (event) { event.stopPropagation(); } },
				h("button", { type: "button", onClick: function () { step(-1); }, disabled: reader.index <= 0, "aria-label": "上一句" }, "‹"),
				h("span", { className: "dsh-tavern-stage-progress" }, reader.beats.length ? (reader.index + 1) + " / " + reader.beats.length : ""),
				h("button", { type: "button", onClick: function () { step(1); }, disabled: atEnd, "aria-label": "下一句" }, "›"),
				h("button", { type: "button", className: auto ? "is-on" : "", onClick: function () { setAuto(!auto); }, "aria-pressed": auto }, "自动"),
				h("button", { type: "button", onClick: function () { reader.setIndex(reader.beats.length - 1, "skip"); tavernSpeech.stop(); } }, "跳过"),
				h(TavernStageReadButton, { reading: reading }),
				h(TavernMusicToggle, null),
				h("span", { className: "dsh-tavern-spacer" }),
				h("button", { type: "button", onClick: props.onClose }, "退出舞台"));
			return h("div", { className: "dsh-tavern-stage-overlay", role: "dialog", "aria-modal": "true", "aria-label": "舞台" },
				h(TavernStageSceneView, { scene: props.scene, view: props.view, sessionId: props.sessionId, data: props.data, beats: reader.beats, index: reader.index, sceneRef: props.sceneRef, onAdvance: function () { step(1); }, footer: footer }),
				atEnd ? h("form", { className: "dsh-tavern-stage-input", onSubmit: send },
					h("input", { value: draft, onChange: function (event) { setDraft(event.target.value); }, placeholder: props.generating ? "正在生成下一轮…" : "接下来做什么？", "aria-label": "舞台输入", disabled: sending }),
					h("button", { type: "submit", disabled: sending || !draft.trim() }, sending ? "发送中…" : "发送")) : null);
		}

		function readTavernFile(file) {
			return new Promise(function (resolve, reject) {
				const reader = new FileReader();
				reader.onload = function () { resolve(String(reader.result).replace(/^data:[^,]*,/, "")); };
				reader.onerror = function () { reject(reader.error || new Error("读取文件失败")); };
				reader.readAsDataURL(file);
			});
		}

		function TavernCastManager(props) {
			const h = React.createElement;
			const data = props.data;
			const [busy, setBusy] = React.useState(false);
			const [notice, setNotice] = React.useState("");
			const [emotion, setEmotion] = React.useState("neutral");
			const speakers = [];
			function add(name) {
				if (!name || name === data.player) return;
				const character = tavernCastCharacter(data.cast, name);
				const label = character ? character.name : name;
				if (speakers.indexOf(label) < 0) speakers.push(label);
			}
			add(data.card.name);
			(data.cast || []).forEach(function (character) { add(character.name); });
			(data.turns || []).forEach(function (turn) { (turn.lines || []).forEach(function (line) { add(line.speaker); }); });
			async function run(method, args, done) {
				setBusy(true); setNotice("");
				try { const result = await rpc(method, args, props.sessionId); props.onCast(result.cast); window.dispatchEvent(new CustomEvent("dsh-tavern-cast-assets-changed")); setNotice(done(result)); }
				catch (error) { setNotice("失败：" + String(error.message || error)); }
				finally { setBusy(false); }
			}
			function pick(accept, handle) {
				const input = document.createElement("input");
				input.type = "file"; input.accept = accept;
				input.onchange = function () { const file = input.files && input.files[0]; if (file) void handle(file); };
				input.click();
			}
			function upload(name, slot) {
				pick("image/png,image/jpeg,image/webp,image/gif", async function (file) {
					const data64 = await readTavernFile(file);
					await run("castSetImage", { name: name, slot: slot, data: data64 }, function () { return "已保存 " + name + " 的" + (slot === "avatar" ? "头像" : TAVERN_CAST_EMOTIONS[slot] + "立绘"); });
				});
			}
			function importPack() {
				pick(".zip,application/zip", async function (file) {
					const data64 = await readTavernFile(file);
					await run("castImportSpritePack", { data: data64 }, function (result) { return "导入 " + result.imported + " 张立绘（" + result.characters.join("、") + "）" + (result.skipped ? "，跳过 " + result.skipped + " 个文件" : ""); });
				});
			}
			return h("section", { className: "dsh-tavern-cast-manager" },
				h("div", { className: "dsh-tavern-cast-manager-head" }, h("strong", null, "角色素材"),
					h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy, onClick: importPack }, "导入 ST 立绘包")),
				h("p", { className: "dsh-tavern-settings-desc" }, "立绘按情绪命名（joy.png、sadness.png…）。单人立绘包导入给「" + (data.card.name || "主角") + "」，多人立绘包按文件夹名对应人物。"),
				h("label", { className: "dsh-tavern-cast-manager-emotion" }, "上传立绘的情绪",
					h("select", { value: emotion, onChange: function (event) { setEmotion(event.target.value); } },
						Object.keys(TAVERN_CAST_EMOTIONS).map(function (key) { return h("option", { key: key, value: key }, TAVERN_CAST_EMOTIONS[key] + " · " + key); }))),
				h("ul", null, speakers.map(function (name) {
					const character = tavernCastCharacter(data.cast, name);
					const count = character ? Object.keys(character.sprites || {}).length : 0;
					return h("li", { key: name, className: "dsh-tavern-cast-manager-row" },
						h(TavernCastAvatar, { speaker: name, imageUrl: tavernCastImage(data, name, "neutral", true) }),
						h("span", { className: "dsh-tavern-cast-manager-name" }, name, h("small", null, count ? count + " 张立绘" : "暂无立绘")),
						h(TavernCastVoiceField, { sessionId: props.sessionId, name: name, character: character, busy: busy,
							onSave: function (provider, voice) { void run("castSetVoice", { name: name, provider: provider, voice: voice }, function () { return voice ? "已保存 " + name + " 的声音" : "已清除 " + name + " 的声音"; }); } }),
						h("button", { type: "button", disabled: busy, onClick: function () { upload(name, "avatar"); } }, "换头像"),
						h("button", { type: "button", disabled: busy, onClick: function () { upload(name, emotion); } }, "加" + TAVERN_CAST_EMOTIONS[emotion] + "立绘"),
						character && !character.plugin ? h("button", { type: "button", disabled: busy, onClick: function () { void run("castRemoveCharacter", { name: character.name }, function () { return "已清除 " + character.name + " 的素材"; }); } }, "清除") : null);
				})),
				notice ? h("p", { role: "status", className: "dsh-tavern-settings-desc" }, notice) : null);
		}

		// Two entries open the same fullscreen stage: the chat header's 「舞台」 and 酒馆状态's 「全屏舞台」.
		function TavernStageEntry(props) {
			const stage = useTavernStageRuntime(props.sessionId);
			const [opened, setOpened] = React.useState(false);
			if (!stage.data || stage.data.enabled === false) return null;
			const h = React.createElement, open = () => setOpened(true);
			return h(React.Fragment, null,
				props.header ? h("button", { type: "button", className: "dsh-tavern-btn dsh-tavern-stage-toggle", title: "全屏舞台", "aria-label": "舞台", onClick: open },
					h("svg", { viewBox: "0 0 24 24", width: 16, height: 16, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, focusable: "false" },
						h("path", { d: "M3.5 4.5h17M5 4.5c0 4 1.8 6.5 4.5 7.5M19 4.5c0 4-1.8 6.5-4.5 7.5M3.5 19.5h17M7 19.5v-3.5h10v3.5" })),
					h("span", null, "舞台")) : h("button", { type: "button", className: "dsh-tavern-btn", onClick: open }, "全屏舞台"),
				opened ? require("react-dom").createPortal(h(TavernStageSession, { ...props, stage, onClose: () => setOpened(false) }), document.body) : null);
		}

		// 酒馆状态 keeps an entry plus cast material, voices and the stage look until the stage settings page.
		function TavernStageStatus(props) {
			const stage = useTavernStageRuntime(props.sessionId);
			const choice = useTavernStageView(props.sessionId);
			if (!stage.data || stage.data.enabled === false) return null;
			const h = React.createElement;
			return h("section", { className: "dsh-tavern-status-section", "aria-label": "舞台素材" }, h(TavernStageEntry, props), h(TavernStageViewSwitch, { choice }),
				h("details", { className: "dsh-tavern-stage-cast" }, h("summary", null, "角色素材"),
					h(TavernCastManager, { sessionId: props.sessionId, data: stage.data, onCast: () => tavernStageRuntime.refresh(props.sessionId) })));
		}

		function TavernStageSession(props) {
			const { data, scene } = props.stage;
			const reader = useTavernStageReader(data, props.sessionId);
			const sceneRef = React.useRef(null);
			const choice = useTavernStageView(props.sessionId);
			const session = () => props.sessions?.binding(props.sessionId)?.session;
			const running = React.useSyncExternalStore(fn => session()?.subscribe(fn) || (() => {}), () => session()?.getSnapshot().running === true);
			const playback = React.useMemo(() => createStagePerformancePlayback({ play: (event, id) => playTavernStagePerformance(sceneRef.current, event, id) }), [props.sessionId]);
			React.useEffect(() => () => playback.dispose(), [playback]);
			React.useEffect(() => {
				playback.update({ id: props.sessionId + ":" + reader.visit, at: reader.index + 1, mode: reader.mode, events: reader.events });
			}, [playback, props.sessionId, reader.visit, reader.index, reader.mode, reader.events]);
			React.useEffect(() => { tavernMusic.play(data.music ? data.music.url : "", { title: data.music ? data.music.name : "" }); }, [data.music && data.music.url]);
			React.useEffect(() => () => tavernMusic.stop(), []);
			return React.createElement(TavernStageFullscreen, { scene, data, reader, sceneRef, view: choice.view, sessionId: props.sessionId,
				generating: props.generating ?? running, onSubmit: text => props.submit(props.sessionId, text), onClose: props.onClose });
		}
