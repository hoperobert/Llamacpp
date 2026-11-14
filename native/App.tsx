import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text,
  TextInput, View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import * as engine from './src/engine';
import {
  deleteModel, isDownloaded, modelUri, pauseDownload, restoreDownloads, startDownload,
  type DownloadState,
} from './src/downloads';
import {
  addMemory, compact, ensureRoom, extractFacts, promptMessages, replyBudget, usedTokens,
} from './src/logic';
import { Markdown } from './src/Markdown';
import { ModelList, type EngineState } from './src/ModelList';
import { MODELS, type Model } from './src/models';
import { Settings } from './src/Settings';
import {
  blankChat, DEFAULT_SETTINGS, store,
  type Chat, type ChatMeta, type Memory, type Message, type Settings as SettingsData,
} from './src/storage';
import { usePalette, type Palette } from './src/theme';

const SUGGESTIONS = [
  'Explain how vaccines work in simple terms',
  'Write a friendly text to reschedule dinner',
  'Give me a 3-day plan to learn the basics of chess',
];

const TEXT_SIZE = 16;

export default function App() {
  return (
    <SafeAreaProvider>
      <Main />
    </SafeAreaProvider>
  );
}

function Main() {
  const [settings, setSettings] = useState<SettingsData>(DEFAULT_SETTINGS);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [chatList, setChatList] = useState<ChatMeta[]>([]);
  const [chat, setChat] = useState<Chat>(blankChat);
  const [engineState, setEngineState] = useState<EngineState>({
    status: 'none', modelId: null, fraction: 0, error: null,
  });
  const [downloaded, setDownloaded] = useState<Set<string>>(new Set());
  const [downloads, setDownloads] = useState<Record<string, DownloadState>>({});
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<Message | null>(null);
  const [status, setStatus] = useState('');
  const [input, setInput] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [crashed, setCrashed] = useState(false);
  const [toast, setToast] = useState('');

  const c = usePalette(settings.theme);
  const scroller = useRef<React.ComponentRef<typeof ScrollView>>(null);

  // The latest values, for callbacks that outlive a render.
  const settingsRef = useRef(settings);
  const memoriesRef = useRef(memories);
  const chatRef = useRef(chat);
  const stopped = useRef(false);
  settingsRef.current = settings;
  memoriesRef.current = memories;
  chatRef.current = chat;

  const ready = engineState.status === 'ready';

  const showToast = useCallback((text: string) => {
    setToast(text);
    setTimeout(() => setToast((current) => (current === text ? '' : current)), 3000);
  }, []);

  const updateSettings = useCallback((patch: Partial<SettingsData>) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    store.saveSettings(next);
    return next;
  }, []);

  const saveMemories = useCallback((next: Memory[]) => {
    memoriesRef.current = next;
    setMemories(next);
    store.saveMemories(next);
  }, []);

  const saveChat = useCallback(async (next: Chat) => {
    const stamped = { ...next, updatedAt: Date.now() };
    chatRef.current = stamped;
    setChat(stamped);
    if (stamped.messages.length) setChatList(await store.saveChat(stamped));
    return stamped;
  }, []);

  // ---------- models ----------

  const load = useCallback(async (model: Model, nCtx = settingsRef.current.nCtx) => {
    setEngineState({ status: 'loading', modelId: model.id, fraction: 0, error: null });
    await store.setLoadMarker({ modelId: model.id, nCtx });
    await activateKeepAwakeAsync('load').catch(() => {});
    try {
      await engine.loadModel(modelUri(model), nCtx, (fraction) =>
        setEngineState((s) => (s.status === 'loading' ? { ...s, fraction } : s)));
      setEngineState({ status: 'ready', modelId: model.id, fraction: 1, error: null });
      updateSettings({ modelId: model.id, loadedOnce: true });
      setCrashed(false);
    } catch (e) {
      setEngineState({
        status: 'none', modelId: model.id, fraction: 0,
        error: `Could not load the model: ${String((e as Error)?.message ?? e)}`,
      });
    }
    await store.setLoadMarker(null);
    deactivateKeepAwake('load').catch(() => {});
  }, [updateSettings]);

  useEffect(() => {
    (async () => {
      const [savedSettings, savedMemories, savedChats, marker] = await Promise.all([
        store.settings(), store.memories(), store.chatList(), store.loadMarker(),
      ]);
      let current = savedSettings;
      // A marker left behind means the last load took the app down, most
      // likely by running out of memory. Do not auto-load into that again.
      if (marker) {
        await store.setLoadMarker(null);
        setCrashed(true);
        if (current.nCtx > 2048) current = { ...current, nCtx: 2048 };
        store.saveSettings(current);
      }
      settingsRef.current = current;
      setSettings(current);
      setMemories(savedMemories);
      setChatList(savedChats);

      const onDevice = new Set<string>();
      for (const m of MODELS) if (await isDownloaded(m)) onDevice.add(m.id);
      setDownloaded(onDevice);

      await restoreDownloads(MODELS, (modelId, state, done) => {
        setDownloads((all) => {
          const next = { ...all };
          if (state) next[modelId] = state;
          else delete next[modelId];
          return next;
        });
        if (done) setDownloaded((set) => new Set(set).add(modelId));
      });

      const preferred = MODELS.find((m) => m.id === current.modelId);
      if (preferred && onDevice.has(preferred.id) && current.loadedOnce && !marker) load(preferred);
    })();
  }, [load]);

  const removeModel = (model: Model) => {
    Alert.alert(`Delete ${model.name}?`, 'It will be removed from this device.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          if (engineState.modelId === model.id) {
            await engine.unloadModel();
            setEngineState({ status: 'none', modelId: null, fraction: 0, error: null });
          }
          await deleteModel(model);
          setDownloaded((set) => { const next = new Set(set); next.delete(model.id); return next; });
        },
      },
    ]);
  };

  const modelList = (
    <ModelList
      c={c}
      engine={engineState}
      downloaded={downloaded}
      downloads={downloads}
      onUse={(m) => load(m)}
      onDownload={startDownload}
      onPause={pauseDownload}
      onDelete={removeModel}
    />
  );

  // ---------- chat ----------

  const runTurn = useCallback(async (userText: string | null) => {
    setBusy(true);
    stopped.current = false;
    setLive({ role: 'assistant', content: '' });
    await activateKeepAwakeAsync('chat').catch(() => {});

    const message: Message = { role: 'assistant', content: '' };
    try {
      const before = chatRef.current;
      if (usedTokens(before, settingsRef.current, memoriesRef.current) >
          settingsRef.current.nCtx - replyBudget(settingsRef.current) - 48) {
        setStatus('Summarising earlier messages…');
        await saveChat(await ensureRoom(before, settingsRef.current, memoriesRef.current));
        setStatus('');
      }
      let lastPaint = 0;
      const result = await engine.chat(
        promptMessages(chatRef.current, settingsRef.current, memoriesRef.current),
        {
          temperature: settingsRef.current.temperature,
          maxTokens: replyBudget(settingsRef.current),
          thinking: settingsRef.current.thinking,
        },
        (content, reasoning) => {
          message.content = content;
          message.reasoning = reasoning;
          // Repainting on every token is wasteful; a few times a second reads the same.
          if (Date.now() - lastPaint > 80) {
            lastPaint = Date.now();
            setLive({ role: 'assistant', content, reasoning });
          }
        },
      );
      message.content = result.content;
      message.reasoning = result.reasoning || undefined;
      message.speed = result.timings.speed;
      if (message.content) {
        const current = chatRef.current;
        const messages = [...current.messages, message];
        await saveChat({
          ...current,
          messages,
          ctx: result.timings.used
            ? { used: result.timings.used, cut: current.cut, count: messages.length }
            : null,
        });
      }
    } catch (e) {
      if (message.content.trim()) {
        const current = chatRef.current;
        await saveChat({ ...current, messages: [...current.messages, { ...message, content: message.content.trim() }], ctx: null });
      } else if (!stopped.current) {
        showToast(`Something went wrong: ${String((e as Error)?.message ?? e)}`);
      }
    }
    setLive(null);

    if (userText && !stopped.current && settingsRef.current.memoryOn && settingsRef.current.autoMemory) {
      const facts = await extractFacts(userText);
      let list = memoriesRef.current;
      let saved = 0;
      for (const fact of facts) {
        const next = addMemory(list, fact);
        if (next) { list = next; saved++; }
      }
      if (saved) {
        saveMemories(list);
        showToast(saved === 1 ? 'Saved 1 memory' : `Saved ${saved} memories`);
      }
    }

    deactivateKeepAwake('chat').catch(() => {});
    setBusy(false);
  }, [saveChat, saveMemories, showToast]);

  const send = async (text: string) => {
    const remember = text.match(/^\/remember\s+([\s\S]+)/i);
    if (remember) {
      const next = addMemory(memoriesRef.current, remember[1]);
      if (next) { saveMemories(next); showToast('Saved to memory'); } else showToast('Already in memory');
      return;
    }
    const current = chatRef.current;
    await saveChat({
      ...current,
      title: current.messages.length ? current.title : text.replace(/\s+/g, ' ').slice(0, 48),
      messages: [...current.messages, { role: 'user', content: text }],
    });
    runTurn(text);
  };

  const submit = () => {
    if (busy) { stopped.current = true; engine.stop(); return; }
    const text = input.trim();
    if (!text || !ready) return;
    setInput('');
    send(text);
  };

  const regenerate = async () => {
    const current = chatRef.current;
    if (busy || !ready || current.messages[current.messages.length - 1]?.role !== 'assistant') return;
    await saveChat({ ...current, messages: current.messages.slice(0, -1), ctx: null });
    runTurn(null);
  };

  const editLast = async () => {
    const current = chatRef.current;
    const index = current.messages.map((m) => m.role).lastIndexOf('user');
    if (busy || index < 0) return;
    setInput(current.messages[index].content);
    const messages = current.messages.slice(0, index);
    if (messages.length) {
      await saveChat({ ...current, messages, ctx: null, cut: Math.min(current.cut, messages.length) });
    } else {
      setChatList(await store.deleteChat(current.id));
      const fresh = blankChat();
      chatRef.current = fresh;
      setChat(fresh);
    }
  };

  const openChat = async (id: string | null) => {
    if (busy) { stopped.current = true; engine.stop(); }
    const next = (id && (await store.chat(id))) || blankChat();
    chatRef.current = next;
    setChat(next);
    setDrawerOpen(false);
  };

  const removeChat = (meta: ChatMeta) => {
    Alert.alert('Delete this chat?', meta.title, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          setChatList(await store.deleteChat(meta.id));
          if (chatRef.current.id === meta.id) openChat(null);
        },
      },
    ]);
  };

  const summariseNow = async () => {
    if (busy || !ready) return;
    setBusy(true);
    setStatus('Summarising earlier messages…');
    const next = await compact(chatRef.current, settingsRef.current, 2);
    if (next) await saveChat(next);
    setStatus('');
    setBusy(false);
  };

  const showContext = () => {
    const used = usedTokens(chat, settings, memories);
    const canCompact = ready && !busy && chat.messages.length - chat.cut > 2;
    Alert.alert(
      'Context',
      `About ${used.toLocaleString()} of ${settings.nCtx.toLocaleString()} tokens used.\n\n` +
        'The model can only hold this much of a chat at once. When it fills up, older messages are summarised or dropped.',
      [
        ...(canCompact ? [{ text: settings.autoSummary ? 'Summarise now' : 'Drop old messages', onPress: summariseNow }] : []),
        { text: 'Close', style: 'cancel' as const },
      ],
    );
  };

  // Changing the context size only takes effect on a reload.
  const changeSettings = (patch: Partial<SettingsData>) => {
    const before = settingsRef.current.nCtx;
    const next = updateSettings(patch);
    const model = MODELS.find((m) => m.id === engineState.modelId);
    if (next.nCtx !== before && ready && model) load(model, next.nCtx);
  };

  // ---------- render ----------

  const activeModel = MODELS.find((m) => m.id === engineState.modelId);
  const subtitle = engineState.status === 'loading'
    ? `Loading… ${Math.round(engineState.fraction * 100)}%`
    : ready && activeModel ? activeModel.name : 'No model loaded · tap to choose';
  const pct = Math.min(100, Math.round((usedTokens(chat, settings, memories) / settings.nCtx) * 100));
  const lastUser = chat.messages.map((m) => m.role).lastIndexOf('user');
  const shown = live ? [...chat.messages, live] : chat.messages;
  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Up late?' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: c.bg }]}>
      <StatusBar style={c.dark ? 'light' : 'dark'} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.header, { borderBottomColor: c.line }]}>
          <IconButton c={c} label="Chats" glyph="☰" onPress={() => setDrawerOpen(true)} />
          <Pressable style={styles.heading} onPress={() => setSettingsOpen(true)}>
            <Text numberOfLines={1} style={[styles.title, { color: c.text }]}>{chat.title}</Text>
            <Text numberOfLines={1} style={[styles.subtitle, { color: c.muted }]}>{subtitle}</Text>
          </Pressable>
          {chat.messages.length > 0 && (
            <Pressable onPress={showContext} hitSlop={8} style={[styles.ctx, { borderColor: pct >= 75 ? c.danger : c.line }]}>
              <Text style={[styles.ctxText, { color: c.text }]}>{pct}%</Text>
            </Pressable>
          )}
          <IconButton c={c} label="New chat" glyph="＋" onPress={() => openChat(null)} />
        </View>

        <ScrollView
          ref={scroller}
          style={styles.flex}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}
        >
          {shown.length === 0 && !ready && (
            <View style={styles.intro}>
              <Text style={[styles.h1, { color: c.text }]}>A private assistant in your pocket</Text>
              <Text style={[styles.point, { color: c.muted }]}>✓  Runs on this device. Nothing you type leaves it.</Text>
              <Text style={[styles.point, { color: c.muted }]}>✓  Works offline once a model is downloaded.</Text>
              <Text style={[styles.point, { color: c.muted }]}>✓  Downloads carry on in the background.</Text>
              {crashed && (
                <View style={[styles.note, { borderColor: c.danger }]}>
                  <Text style={{ color: c.text }}>
                    The app ran out of memory loading a model last time. The context size has been
                    set to Small. A smaller model may also help.
                  </Text>
                </View>
              )}
              <Text style={[styles.sectionLabel, { color: c.muted }]}>PICK A MODEL</Text>
              {modelList}
            </View>
          )}

          {shown.length === 0 && ready && (
            <View style={styles.intro}>
              <Text style={[styles.h1, { color: c.text }]}>{greeting}</Text>
              <Text style={{ color: c.muted }}>
                {activeModel?.name} is ready. Everything stays on this device.
              </Text>
              <View style={styles.chips}>
                {SUGGESTIONS.map((text) => (
                  <Pressable
                    key={text}
                    onPress={() => !busy && send(text)}
                    style={({ pressed }) => [styles.chip, { borderColor: c.line, backgroundColor: pressed ? c.sunken : c.surface }]}
                  >
                    <Text style={{ color: c.text, fontSize: 15 }}>{text}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {shown.map((m, i) => (
            <React.Fragment key={i}>
              {chat.cut > 0 && i === chat.cut && (
                <Text style={[styles.divider, { color: c.muted }]}>
                  {chat.summary ? 'Earlier messages summarised' : 'Earlier messages are out of context'}
                </Text>
              )}
              <MessageView
                c={c}
                message={m}
                streaming={m === live}
                canEdit={!busy && i === lastUser}
                canRetry={!busy && ready && m !== live && i === chat.messages.length - 1}
                onEdit={editLast}
                onRetry={regenerate}
                onCopy={async () => { await Clipboard.setStringAsync(m.content); showToast('Copied'); }}
              />
            </React.Fragment>
          ))}
        </ScrollView>

        <View style={styles.footer}>
          {!!status && <Text style={[styles.status, { color: c.muted }]}>{status}</Text>}
          <View style={[styles.composer, { backgroundColor: c.surface, borderColor: c.line }]}>
            <TextInput
              value={input}
              onChangeText={setInput}
              multiline
              placeholder={ready ? 'Message' : engineState.status === 'loading' ? 'Getting the model ready…' : 'Choose a model to start'}
              placeholderTextColor={c.muted}
              style={[styles.input, { color: c.text }]}
            />
            <Pressable
              onPress={submit}
              disabled={!busy && (!ready || !input.trim())}
              accessibilityLabel={busy ? 'Stop' : 'Send'}
              style={[styles.send, { backgroundColor: busy || (ready && input.trim()) ? c.accent : c.line }]}
            >
              <Text style={[styles.sendGlyph, { color: c.accentText }]}>{busy ? '■' : '↑'}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>

      {!!toast && (
        <View pointerEvents="none" style={[styles.toast, { backgroundColor: c.text }]}>
          <Text style={{ color: c.bg }}>{toast}</Text>
        </View>
      )}

      <Modal visible={drawerOpen} transparent animationType="fade" onRequestClose={() => setDrawerOpen(false)}>
        <View style={styles.drawerRow}>
          <SafeAreaView style={[styles.drawer, { backgroundColor: c.bg, borderRightColor: c.line }]}>
            <Text style={[styles.drawerTitle, { color: c.text }]}>Chats</Text>
            <Pressable onPress={() => openChat(null)} style={[styles.newChat, { borderColor: c.line, backgroundColor: c.surface }]}>
              <Text style={{ color: c.text, fontSize: 16 }}>＋  New chat</Text>
            </Pressable>
            <ScrollView style={styles.flex}>
              {chatList.length === 0 && (
                <Text style={[styles.empty, { color: c.muted }]}>Your chats will appear here.</Text>
              )}
              {chatList.map((meta) => (
                <Pressable
                  key={meta.id}
                  onPress={() => openChat(meta.id)}
                  onLongPress={() => removeChat(meta)}
                  style={[styles.chatItem, meta.id === chat.id && { backgroundColor: c.sunken }]}
                >
                  <Text numberOfLines={1} style={{ color: c.text, fontSize: 16 }}>{meta.title}</Text>
                </Pressable>
              ))}
              {chatList.length > 0 && (
                <Text style={[styles.empty, { color: c.muted }]}>Press and hold a chat to delete it.</Text>
              )}
            </ScrollView>
            <Pressable
              onPress={() => { setDrawerOpen(false); setSettingsOpen(true); }}
              style={[styles.drawerFoot, { borderTopColor: c.line }]}
            >
              <Text style={{ color: c.text, fontSize: 16 }}>Settings</Text>
            </Pressable>
          </SafeAreaView>
          <Pressable style={styles.scrim} onPress={() => setDrawerOpen(false)} accessibilityLabel="Close" />
        </View>
      </Modal>

      <Settings
        visible={settingsOpen}
        c={c}
        settings={settings}
        memories={memories}
        models={modelList}
        onChange={changeSettings}
        onAddMemory={(text) => {
          const next = addMemory(memoriesRef.current, text);
          if (next) saveMemories(next);
        }}
        onRemoveMemory={(id) => saveMemories(memoriesRef.current.filter((m) => m.id !== id))}
        onDeleteChats={() => Alert.alert('Delete every chat?', 'This cannot be undone.', [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete all', style: 'destructive',
            onPress: async () => { await store.deleteAllChats(); setChatList([]); openChat(null); },
          },
        ])}
        onDeleteMemories={() => Alert.alert('Delete every memory?', 'This cannot be undone.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete all', style: 'destructive', onPress: () => saveMemories([]) },
        ])}
        onClose={() => setSettingsOpen(false)}
      />
    </SafeAreaView>
  );
}

function IconButton({ c, glyph, label, onPress }: { c: Palette; glyph: string; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} hitSlop={6} style={styles.iconButton}>
      <Text style={[styles.icon, { color: c.text }]}>{glyph}</Text>
    </Pressable>
  );
}

function MessageView({ c, message, streaming, canEdit, canRetry, onEdit, onRetry, onCopy }: {
  c: Palette; message: Message; streaming: boolean; canEdit: boolean; canRetry: boolean;
  onEdit: () => void; onRetry: () => void; onCopy: () => void;
}) {
  if (message.role === 'user') {
    return (
      <View style={styles.userRow}>
        <View style={[styles.userBubble, { backgroundColor: c.user }]}>
          <Text selectable style={{ color: c.text, fontSize: TEXT_SIZE, lineHeight: TEXT_SIZE * 1.5 }}>
            {message.content}
          </Text>
        </View>
        {canEdit && (
          <Pressable onPress={onEdit} hitSlop={8}>
            <Text style={[styles.action, { color: c.muted }]}>Edit</Text>
          </Pressable>
        )}
      </View>
    );
  }
  return (
    <View style={styles.assistant}>
      {!!message.reasoning && (
        <Text style={[styles.thinking, { color: c.muted, borderLeftColor: c.line }]}>
          {message.reasoning.trim()}
        </Text>
      )}
      {streaming && !message.content && !message.reasoning
        ? <Text style={[styles.working, { color: c.muted }]}>● ● ●</Text>
        : <Markdown source={message.content} c={c} size={TEXT_SIZE} />}
      {!streaming && !!message.content && (
        <View style={styles.actions}>
          <Pressable onPress={onCopy} hitSlop={8}>
            <Text style={[styles.action, { color: c.muted }]}>Copy</Text>
          </Pressable>
          {canRetry && (
            <Pressable onPress={onRetry} hitSlop={8}>
              <Text style={[styles.action, { color: c.muted }]}>Try again</Text>
            </Pressable>
          )}
          {!!message.speed && (
            <Text style={[styles.action, { color: c.muted }]}>{message.speed.toFixed(1)} tokens/s</Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 6, borderBottomWidth: 1,
  },
  heading: { flex: 1, paddingHorizontal: 4 },
  title: { fontSize: 16, fontWeight: '600' },
  subtitle: { fontSize: 12 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  icon: { fontSize: 22 },
  ctx: { borderWidth: 2, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  ctxText: { fontSize: 11, fontWeight: '600' },
  body: { padding: 16, gap: 16, flexGrow: 1 },
  intro: { gap: 8, paddingTop: 24 },
  h1: { fontSize: 24, fontWeight: '700', letterSpacing: -0.4, marginBottom: 4 },
  point: { fontSize: 16, lineHeight: 24 },
  sectionLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 0.6, marginTop: 20, marginBottom: 4 },
  note: { borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 12 },
  chips: { gap: 8, marginTop: 12 },
  chip: { borderWidth: 1, borderRadius: 12, padding: 14 },
  divider: { textAlign: 'center', fontSize: 12 },
  userRow: { alignItems: 'flex-end', gap: 4 },
  userBubble: { maxWidth: '86%', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9 },
  assistant: { gap: 8 },
  thinking: { fontSize: 14, fontStyle: 'italic', borderLeftWidth: 2, paddingLeft: 12 },
  working: { fontSize: 12, letterSpacing: 2, paddingVertical: 6 },
  actions: { flexDirection: 'row', gap: 16, alignItems: 'center' },
  action: { fontSize: 13 },
  footer: { paddingHorizontal: 16, paddingBottom: 8, paddingTop: 4 },
  status: { fontSize: 12, marginBottom: 6, marginLeft: 2 },
  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 6,
    borderWidth: 1, borderRadius: 24, paddingLeft: 16, paddingRight: 6, paddingVertical: 6,
  },
  input: { flex: 1, fontSize: 16, maxHeight: 150, paddingTop: 8, paddingBottom: 8 },
  send: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  sendGlyph: { fontSize: 18, fontWeight: '700' },
  toast: {
    position: 'absolute', alignSelf: 'center', bottom: 110,
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 14,
  },
  drawerRow: { flex: 1, flexDirection: 'row' },
  drawer: { width: '82%', maxWidth: 320, borderRightWidth: 1 },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  drawerTitle: { fontSize: 17, fontWeight: '700', paddingHorizontal: 16, paddingVertical: 14 },
  newChat: { marginHorizontal: 8, marginBottom: 8, borderWidth: 1, borderRadius: 10, padding: 12 },
  chatItem: { marginHorizontal: 8, paddingHorizontal: 10, paddingVertical: 12, borderRadius: 10 },
  empty: { paddingHorizontal: 18, paddingVertical: 12, fontSize: 13 },
  drawerFoot: { borderTopWidth: 1, paddingHorizontal: 18, paddingVertical: 16 },
});
