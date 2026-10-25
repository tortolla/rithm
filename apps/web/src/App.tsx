import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ArrowRight, Bell, BookOpen, CalendarDays, Check, ChevronLeft, Circle, Clock3,
  Home, Lightbulb, LoaderCircle, MoreHorizontal, Pencil, Plus, RotateCcw, Settings,
  Sparkles, TrendingUp, Trash2, X
} from 'lucide-react';
import { api, haptic } from './api';
import type { Bootstrap, Direction, HabitTemplate, Idea, SprintHabit, Stats } from './types';

const weekdayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function isoToday() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', weekday: 'long' })
    .format(new Date(`${value}T12:00:00`));
}

function addDays(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function Logo({ inverse = false }: { inverse?: boolean }) {
  return <div className={`logo ${inverse ? 'inverse' : ''}`}>Р И Т М</div>;
}

function PrimaryButton({ children, onClick, disabled, light = false, type = 'button' }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; light?: boolean; type?: 'button' | 'submit';
}) {
  return <button type={type} className={`primary-button ${light ? 'light' : ''}`} onClick={onClick} disabled={disabled}>
    <span>{children}</span><ArrowRight size={21} />
  </button>;
}

function LoadingScreen() {
  return <main className="center-screen dark"><Logo inverse /><LoaderCircle className="spinner" /></main>;
}

function ErrorScreen({ message, retry }: { message: string; retry: () => void }) {
  return <main className="center-screen"><Logo /><h1>Что-то сбилось.</h1><p>{message}</p><PrimaryButton onClick={retry}>Попробовать снова</PrimaryButton></main>;
}

function Onboarding({ data, onCreated }: { data: Bootstrap; onCreated: () => Promise<void> }) {
  const [screen, setScreen] = useState<'splash' | 'concept' | 'wizard'>(data.user.onboardingCompleted ? 'wizard' : 'splash');
  if (screen === 'splash') return <main className="splash-screen">
    <div className="splash-top"><Logo inverse /><button onClick={() => setScreen('wizard')}>ПРОПУСТИТЬ</button></div>
    <div className="splash-copy">
      <div className="eyebrow light-text">ПРИВЫЧКИ · СПРИНТЫ · ТВОЙ РИТМ</div>
      <h1>Большие цели<br />начинаются<br />с маленьких<br />шагов.</h1>
    </div>
    <PrimaryButton light onClick={() => setScreen('concept')}>Начать</PrimaryButton>
  </main>;

  if (screen === 'concept') return <main className="concept-screen">
    <div className="top-row"><Logo /><button onClick={() => setScreen('wizard')}>Пропустить</button></div>
    <div className="step-count">1 / 3</div>
    <h1>Найди свой<br />ритм.</h1>
    <p className="lead">Выбери важные направления жизни, добавь небольшие привычки и двигайся в собственном темпе.</p>
    <div className="concept-list">
      <div><span>01</span><strong>Направление</strong><p>То, чему хочется уделять больше внимания.</p></div>
      <div><span>02</span><strong>Маленькое действие</strong><p>Шаг, который реально повторить в обычный день.</p></div>
      <div><span>03</span><strong>Спринт</strong><p>Ограниченный период, чтобы попробовать и заметить изменения.</p></div>
    </div>
    <PrimaryButton onClick={() => setScreen('wizard')}>Выбрать направления</PrimaryButton>
  </main>;

  return <SprintWizard catalog={data.catalog} onCreated={onCreated} />;
}

type DraftHabit = {
  direction: Direction;
  templateId?: string;
  name: string;
  description: string;
  scheduleDays: number[];
  reminderEnabled: boolean;
  reminderTime: string;
};

function SprintWizard({ catalog, onCreated }: { catalog: Direction[]; onCreated: () => Promise<void> }) {
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [habits, setHabits] = useState<Record<string, DraftHabit>>({});
  const [durationDays, setDurationDays] = useState<14 | 21 | 30>(21);
  const [startDate, setStartDate] = useState(isoToday());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const chosenDirections = catalog.filter((direction) => selected.includes(direction.id));
  const readyHabits = chosenDirections.map((direction) => habits[direction.id]).filter(Boolean);

  const toggleDirection = (direction: Direction) => {
    setError('');
    setSelected((current) => current.includes(direction.id)
      ? current.filter((id) => id !== direction.id)
      : current.length < 3 ? [...current, direction.id] : current);
    haptic();
  };

  const chooseHabit = (direction: Direction, template?: HabitTemplate, customName?: string) => {
    setHabits((current) => ({
      ...current,
      [direction.id]: {
        direction,
        templateId: template?.id,
        name: template?.name ?? customName ?? '',
        description: template?.description ?? '',
        scheduleDays: template?.defaultDays ?? [1,2,3,4,5,6,7],
        reminderEnabled: true,
        reminderTime: '21:00'
      }
    }));
    haptic();
  };

  const next = () => {
    setError('');
    if (step === 0 && !selected.length) return setError('Выбери хотя бы одно направление');
    if (step === 1 && readyHabits.length !== chosenDirections.length) return setError('Выбери по одной привычке для каждого направления');
    setStep((value) => Math.min(3, value + 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const create = async () => {
    setSaving(true); setError('');
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow';
      await api.settings({ timezone, eveningCheckinEnabled: true, weeklyReportEnabled: true });
      await api.createSprint({
        durationDays, startDate,
        habits: readyHabits.map((habit) => ({
          directionId: habit.direction.id, templateId: habit.templateId ?? null,
          name: habit.name, description: habit.description,
          scheduleDays: habit.scheduleDays, reminderEnabled: habit.reminderEnabled,
          reminderTime: habit.reminderTime
        }))
      });
      haptic('heavy');
      await onCreated();
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось создать спринт'); }
    finally { setSaving(false); }
  };

  return <main className={`wizard-screen ${step === 1 ? 'dark' : ''}`}>
    <header className="wizard-header">
      {step > 0 ? <button aria-label="Назад" onClick={() => setStep(step - 1)}><ChevronLeft /></button> : <span />}
      <Logo inverse={step === 1} />
      <span>{step + 2} / 5</span>
    </header>

    {step === 0 && <section>
      <div className="eyebrow">ТВОЙ ПЕРВЫЙ СПРИНТ</div>
      <h1>Выбери<br />направления.</h1>
      <p className="lead">В каких сферах ты хочешь увидеть изменения? Можно выбрать до трёх.</p>
      <div className="direction-grid">
        {catalog.map((direction) => <button key={direction.id} className={`direction-card ${selected.includes(direction.id) ? 'selected' : ''}`} onClick={() => toggleDirection(direction)} style={{ '--card-color': direction.color } as React.CSSProperties}>
          <span className="direction-icon">{direction.emoji}</span>
          <span className="select-dot">{selected.includes(direction.id) ? <Check size={16} /> : null}</span>
          <strong>{direction.name}</strong><small>{direction.description}</small>
        </button>)}
      </div>
    </section>}

    {step === 1 && <section>
      <div className="eyebrow light-text">ОДИН МАЛЕНЬКИЙ ШАГ ЗА РАЗ</div>
      <h1>Выбери первую<br />привычку.</h1>
      <p className="lead muted-light">По одной привычке на каждое направление. Позже их можно будет изменить.</p>
      <div className="habit-groups">
        {chosenDirections.map((direction) => <HabitChooser key={direction.id} direction={direction} selected={habits[direction.id]} onChoose={chooseHabit} />)}
      </div>
    </section>}

    {step === 2 && <section>
      <div className="eyebrow">ТВОЙ ТЕМП</div>
      <h1>Настрой<br />свой спринт.</h1>
      <p className="lead">Это не срок для идеального результата. Это время, чтобы попробовать и найти свой ритм.</p>
      <label className="field-label">ДЛИТЕЛЬНОСТЬ</label>
      <div className="duration-picker">{([14,21,30] as const).map((days) => <button className={durationDays === days ? 'selected' : ''} onClick={() => setDurationDays(days)} key={days}><strong>{days}</strong><span>дней</span></button>)}</div>
      <label className="field-label" htmlFor="start-date">ДАТА СТАРТА</label>
      <div className="input-row"><CalendarDays size={20} /><input id="start-date" type="date" value={startDate} min={isoToday()} onChange={(e) => setStartDate(e.target.value)} /></div>
      <div className="habit-settings">
        {readyHabits.map((habit) => <HabitSettings key={habit.direction.id} habit={habit} update={(next) => setHabits((current) => ({ ...current, [habit.direction.id]: next }))} />)}
      </div>
    </section>}

    {step === 3 && <section>
      <div className="eyebrow">ВСЁ ГОТОВО</div>
      <h1>Твой первый<br />спринт.</h1>
      <p className="lead">{durationDays} день · с {new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date(`${startDate}T12:00:00`))}</p>
      <div className="review-list">{readyHabits.map((habit) => <div key={habit.direction.id} className="review-card"><span style={{ background: habit.direction.color }}>{habit.direction.emoji}</span><div><small>{habit.direction.name}</small><strong>{habit.name}</strong><p>{habit.scheduleDays.length === 7 ? 'Каждый день' : habit.scheduleDays.map((day) => weekdayNames[day - 1]).join(', ')} · {habit.reminderEnabled ? habit.reminderTime : 'без напоминания'}</p></div></div>)}</div>
      <div className="focus-note"><Sparkles size={20} /><p><strong>Не больше. А устойчивее.</strong><br />Один маленький шаг за раз.</p></div>
    </section>}

    <footer className="wizard-footer">
      {error && <p className="form-error">{error}</p>}
      <PrimaryButton disabled={saving} onClick={step === 3 ? create : next}>{saving ? 'Создаём…' : step === 3 ? 'Начать спринт' : 'Продолжить'}</PrimaryButton>
    </footer>
  </main>;
}

function HabitChooser({ direction, selected, onChoose }: { direction: Direction; selected?: DraftHabit; onChoose: (direction: Direction, template?: HabitTemplate, customName?: string) => void }) {
  const [custom, setCustom] = useState('');
  return <div className="habit-group">
    <h2><span>{direction.emoji}</span>{direction.name}</h2>
    {direction.habits.map((habit) => <button key={habit.id} className={`habit-option ${selected?.templateId === habit.id ? 'selected' : ''}`} onClick={() => onChoose(direction, habit)}><div><strong>{habit.name}</strong><small>{habit.description}</small></div><span className="round-check">{selected?.templateId === habit.id ? <Check size={17} /> : null}</span></button>)}
    <form className={`custom-habit ${selected && !selected.templateId ? 'selected' : ''}`} onSubmit={(e) => { e.preventDefault(); if (custom.trim()) onChoose(direction, undefined, custom.trim()); }}>
      <Plus size={19} /><input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Создать свою привычку" maxLength={100} /><button type="submit">Добавить</button>
    </form>
  </div>;
}

function HabitSettings({ habit, update }: { habit: DraftHabit; update: (habit: DraftHabit) => void }) {
  return <div className="settings-card">
    <div className="settings-title"><span style={{ background: habit.direction.color }}>{habit.direction.emoji}</span><strong>{habit.name}</strong></div>
    <div className="days-picker">{weekdayNames.map((label, index) => { const value = index + 1; return <button className={habit.scheduleDays.includes(value) ? 'selected' : ''} key={label} onClick={() => update({ ...habit, scheduleDays: habit.scheduleDays.includes(value) ? habit.scheduleDays.filter((day) => day !== value) : [...habit.scheduleDays, value].sort() })}>{label}</button>; })}</div>
    <label className="toggle-row"><span><Bell size={18} />Напоминать</span><input type="checkbox" checked={habit.reminderEnabled} onChange={(e) => update({ ...habit, reminderEnabled: e.target.checked })} /></label>
    {habit.reminderEnabled && <label className="time-row"><Clock3 size={18} /><input type="time" value={habit.reminderTime} onChange={(e) => update({ ...habit, reminderTime: e.target.value })} /></label>}
  </div>;
}

type Tab = 'today' | 'calendar' | 'progress' | 'ideas' | 'more';

function Dashboard({ data, refresh }: { data: Bootstrap; refresh: () => Promise<void> }) {
  const [tab, setTab] = useState<Tab>('today');
  const [stats, setStats] = useState<Stats | null>(null);
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState('');
  const [completion, setCompletion] = useState<Stats | null>(null);
  const sprint = data.sprint!;

  const loadStats = async () => setStats(await api.stats());
  useEffect(() => { if (tab === 'calendar' || tab === 'progress') void loadStats(); }, [tab]);

  const action = async (habit: SprintHabit, actionName: 'done' | 'skip' | 'postponeToday' | 'postponeTomorrow') => {
    if (!habit.log || busy) return;
    setBusy(habit.id);
    try {
      const result = await api.habitAction(habit.id, { action: actionName, scheduledDate: habit.log.scheduledDate });
      if (result.quote) setToast(result.quote);
      haptic(actionName === 'done' ? 'heavy' : 'light');
      await refresh();
    } catch (e) { setToast(e instanceof Error ? e.message : 'Не удалось сохранить'); }
    finally { setBusy(''); }
  };

  if (completion) return <CompletionView stats={completion} onNext={refresh} />;

  return <main className="app-shell">
    <header className="app-header"><Logo /><div><button onClick={() => setTab('more')} aria-label="Настройки"><Settings size={23} /></button></div></header>
    {tab === 'today' && <Today sprint={sprint} quote={data.quote} action={action} busy={busy} />}
    {tab === 'calendar' && <CalendarView sprint={sprint} stats={stats} />}
    {tab === 'progress' && <ProgressView stats={stats} />}
    {tab === 'ideas' && <IdeasView ideas={data.ideas} catalog={data.catalog} refresh={refresh} />}
    {tab === 'more' && <MoreView data={data} refresh={refresh} onCompleted={setCompletion} />}
    <BottomNav tab={tab} setTab={setTab} />
    {toast && <button className="toast" onClick={() => setToast('')}><X size={17} /><span>{toast}</span></button>}
  </main>;
}

function Today({ sprint, quote, action, busy }: { sprint: NonNullable<Bootstrap['sprint']>; quote: string; action: (habit: SprintHabit, action: 'done' | 'skip' | 'postponeToday' | 'postponeTomorrow') => void; busy: string }) {
  const done = sprint.todayHabits.filter((habit) => habit.log?.state === 'done').length;
  const total = sprint.todayHabits.length;
  const percent = total ? Math.round(done * 100 / total) : 0;
  const dates = Array.from({ length: 7 }, (_, index) => addDays(sprint.today, index - 3));
  return <section className="tab-content today-view">
    <h1>Сегодня</h1><p className="date-title">{dateLabel(sprint.today)}</p>
    <div className="week-strip">{dates.map((date) => <div className={date === sprint.today ? 'selected' : ''} key={date}><small>{weekdayNames[(new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7]}</small><strong>{Number(date.slice(-2))}</strong></div>)}</div>
    <div className="progress-hero"><div><div className="eyebrow light-text">СЕГОДНЯ</div><strong>{done}<small> из {total}</small></strong><p>привычки выполнены</p></div><div className="progress-ring" style={{ '--progress': `${percent * 3.6}deg` } as React.CSSProperties}><span>{percent}%</span></div></div>
    <div className="today-habits">
      {!total && <div className="empty-state"><Sparkles /><h3>Сегодня свободный день</h3><p>В расписании нет привычек. Можно просто заметить этот спокойный ритм.</p></div>}
      {sprint.todayHabits.map((habit) => <div className={`today-habit ${habit.log?.state ?? ''}`} key={`${habit.id}-${habit.log?.scheduledDate}`}>
        <span className="habit-symbol" style={{ background: habit.color }}>{habit.emoji}</span>
        <div className="habit-copy"><strong>{habit.name}</strong><small>{habit.description || habit.directionName}</small>{habit.log?.state === 'postponed' && <em>Перенесено</em>}{habit.log?.state === 'skipped' && <em>Не сегодня</em>}</div>
        <button className="complete-button" disabled={busy === habit.id || habit.log?.state === 'done' || habit.log?.state === 'skipped'} onClick={() => action(habit, 'done')} aria-label="Отметить выполненной">{busy === habit.id ? <LoaderCircle className="spinner" /> : habit.log?.state === 'done' ? <Check /> : <Circle />}</button>
        {habit.log?.state !== 'done' && habit.log?.state !== 'skipped' && <details className="habit-menu"><summary><MoreHorizontal /></summary><div><button onClick={() => action(habit, 'postponeToday')}>Сегодня позже</button><button onClick={() => action(habit, 'postponeTomorrow')}>На завтра</button><button onClick={() => action(habit, 'skip')}>Не сегодня</button></div></details>}
      </div>)}
    </div>
    <div className="quote-card"><div><span>МЫСЛЬ ДНЯ</span><RotateCcw size={18} /></div><p>{quote}</p></div>
  </section>;
}

function CalendarView({ sprint, stats }: { sprint: NonNullable<Bootstrap['sprint']>; stats: Stats | null }) {
  const days = Array.from({ length: sprint.durationDays }, (_, index) => addDays(sprint.startDate, index));
  const dayState = (date: string) => {
    const logs = stats?.habits.flatMap((habit) => habit.logs ?? []).filter((log) => log.date === date) ?? [];
    if (!logs.length) return date > sprint.today ? 'future' : 'empty';
    if (logs.every((log) => log.state === 'done')) return 'done';
    if (logs.some((log) => log.state === 'done')) return 'partial';
    return 'missed';
  };
  return <section className="tab-content"><div className="eyebrow">ТЕКУЩИЙ СПРИНТ</div><h1>Календарь</h1><p className="lead">{sprint.durationDays} дней · {sprint.startDate.split('-').reverse().join('.')} — {sprint.endDate.split('-').reverse().join('.')}</p>
    <div className="calendar-card"><div className="calendar-weekdays">{weekdayNames.map((day) => <span key={day}>{day}</span>)}</div><div className="calendar-grid">{days.map((date) => <div className={`${dayState(date)} ${date === sprint.today ? 'today' : ''}`} key={date}><span>{Number(date.slice(-2))}</span></div>)}</div></div>
    <div className="calendar-legend"><span><i className="done" />Всё сделано</span><span><i className="partial" />Частично</span><span><i className="missed" />Пропущено</span></div>
    <h2>Расписание</h2>{sprint.habits.map((habit) => <div className="schedule-row" key={habit.id}><span style={{ background: habit.color }}>{habit.emoji}</span><div><strong>{habit.name}</strong><small>{habit.scheduleDays.length === 7 ? 'Каждый день' : habit.scheduleDays.map((day) => weekdayNames[day - 1]).join(', ')} · {habit.reminderTime.slice(0,5)}</small></div></div>)}
  </section>;
}

function ProgressView({ stats }: { stats: Stats | null }) {
  if (!stats) return <section className="tab-content loading-tab"><LoaderCircle className="spinner" /></section>;
  return <section className="tab-content"><div className="eyebrow">ТВОЙ РИТМ</div><h1>Прогресс</h1><div className="big-percent"><strong>{stats.totals.percent}%</strong><p>{stats.totals.done} из {stats.totals.planned} запланированных действий</p></div>
    <h2>По привычкам</h2><div className="habit-progress-list">{stats.habits.map((habit) => { const percent = habit.planned ? Math.round(habit.done * 100 / habit.planned) : 0; return <div key={habit.id}><div><strong>{habit.name}</strong><span>{habit.done} из {habit.planned}</span></div><div className="bar"><i style={{ width: `${percent}%` }} /></div></div>; })}</div>
    <div className="reflection"><Sparkles /><div><strong>Это не оценка.</strong><p>Статистика помогает заметить, какие действия вписываются в твою жизнь, а какие стоит сделать проще.</p></div></div>
  </section>;
}

function IdeasView({ ideas, catalog, refresh }: { ideas: Idea[]; catalog: Direction[]; refresh: () => Promise<void> }) {
  const [title, setTitle] = useState(''); const [saving, setSaving] = useState(false);
  const add = async (event: React.FormEvent) => { event.preventDefault(); if (!title.trim()) return; setSaving(true); try { await api.addIdea({ title: title.trim(), description: '' }); setTitle(''); await refresh(); } finally { setSaving(false); } };
  const addTemplate = async (habit: HabitTemplate) => { await api.addIdea({ title: habit.name, description: habit.description, directionId: habit.directionId, templateId: habit.id }); await refresh(); };
  return <section className="tab-content"><div className="eyebrow">БЕЗ ДЕДЛАЙНОВ И ОБЯЗАТЕЛЬСТВ</div><h1>Хочу<br />попробовать</h1><p className="lead">Личная коллекция идей на будущее. Здесь ничего не нужно успевать.</p>
    <form className="idea-form" onSubmit={add}><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Например, начать рисовать" /><button disabled={saving}><Plus /></button></form>
    <div className="ideas-list">{ideas.map((idea) => <div key={idea.id}><Lightbulb size={20} /><div><strong>{idea.title}</strong><small>{idea.description}</small></div><button onClick={async () => { const next = prompt('Название идеи', idea.title)?.trim(); if (next && next !== idea.title) { await api.updateIdea(idea.id, { title: next, description: idea.description, directionId: idea.directionId ?? null }); await refresh(); } }} aria-label="Редактировать"><Pencil size={17} /></button><button onClick={async () => { await api.deleteIdea(idea.id); await refresh(); }} aria-label="Удалить"><Trash2 size={18} /></button></div>)}</div>
    {!ideas.length && <div className="empty-state"><Lightbulb /><h3>Пока здесь пусто</h3><p>Добавляй всё, что однажды хочется попробовать.</p></div>}
    <h2>Идеи из каталога</h2><div className="suggestion-chips">{catalog.slice(0, 6).flatMap((direction) => direction.habits.slice(0, 1)).map((habit) => <button key={habit.id} onClick={() => addTemplate(habit)}><Plus size={15} />{habit.name}</button>)}</div>
  </section>;
}

function MoreView({ data, refresh, onCompleted }: { data: Bootstrap; refresh: () => Promise<void>; onCompleted: (stats: Stats) => void }) {
  const [ending, setEnding] = useState(false);
  const finish = async () => { if (!confirm('Завершить текущий спринт? История сохранится.')) return; setEnding(true); try { const result = await api.completeSprint(); onCompleted(result.stats); } finally { setEnding(false); } };
  return <section className="tab-content"><div className="eyebrow">ТВОЯ СИСТЕМА</div><h1>Ещё</h1><div className="profile-card"><span>{data.user.firstName.slice(0,1).toUpperCase()}</span><div><strong>{data.user.firstName}</strong><small>{data.user.timezone}</small></div></div>
    <div className="more-list"><div><Bell /><span><strong>Напоминания</strong><small>Включены для выбранных привычек</small></span></div><div><Clock3 /><span><strong>Вечерний check-in</strong><small>Каждый день в 21:30</small></span></div><div><TrendingUp /><span><strong>Недельный отчёт</strong><small>По воскресеньям</small></span></div></div>
    <h2>Настройки привычек</h2><div className="edit-habits">{data.sprint?.habits.map((habit) => <EditHabit key={habit.id} habit={habit} refresh={refresh} />)}</div>
    <div className="about-card"><div className="eyebrow">О РИТМЕ</div><h2>Большие изменения начинаются с маленьких шагов.</h2><p>Приложение создала Настя Сычёва, чтобы двигаться к изменениям без перегруза и постоянного чувства, что что-то не успеваешь.</p></div>
    <button className="danger-button" onClick={finish} disabled={ending}>{ending ? 'Завершаем…' : 'Завершить текущий спринт'}</button>
  </section>;
}

function EditHabit({ habit, refresh }: { habit: SprintHabit; refresh: () => Promise<void> }) {
  const [days, setDays] = useState(habit.scheduleDays);
  const [time, setTime] = useState(habit.reminderTime.slice(0, 5));
  const [enabled, setEnabled] = useState(habit.reminderEnabled);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!days.length) return;
    setSaving(true);
    try { await api.updateHabit(habit.id, { scheduleDays: days, reminderTime: time, reminderEnabled: enabled }); await refresh(); haptic('medium'); }
    finally { setSaving(false); }
  };
  return <details className="edit-habit"><summary><span style={{ background: habit.color }}>{habit.emoji}</span><div><strong>{habit.name}</strong><small>{habit.scheduleDays.length === 7 ? 'Каждый день' : habit.scheduleDays.map((day) => weekdayNames[day - 1]).join(', ')} · {habit.reminderTime.slice(0,5)}</small></div><Settings size={18} /></summary><div className="edit-habit-body">
    <div className="days-picker">{weekdayNames.map((label, index) => { const value = index + 1; return <button className={days.includes(value) ? 'selected' : ''} key={label} onClick={() => setDays(days.includes(value) ? days.filter((day) => day !== value) : [...days, value].sort())}>{label}</button>; })}</div>
    <label className="toggle-row"><span><Bell size={18} />Напоминать</span><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /></label>
    {enabled && <label className="time-row"><Clock3 size={18} /><input type="time" value={time} onChange={(event) => setTime(event.target.value)} /></label>}
    <button className="save-button" onClick={save} disabled={saving || !days.length}>{saving ? 'Сохраняем…' : 'Сохранить'}</button>
  </div></details>;
}

function CompletionView({ stats, onNext }: { stats: Stats; onNext: () => Promise<void> }) {
  return <main className="completion-screen"><div className="completion-top"><Logo inverse /><Sparkles /></div><div><div className="eyebrow light-text">СПРИНТ ЗАВЕРШЁН</div><h1>Ты прошла<br />свой спринт.</h1><p>Это не оценка и не экзамен. Это момент заметить, что получилось и что хочется взять с собой дальше.</p></div>
    <div className="completion-score"><strong>{stats.totals.percent}%</strong><span>{stats.totals.done} из {stats.totals.planned} запланированных действий</span></div>
    <div className="completion-habits">{stats.habits.map((habit) => <div key={habit.id}><span>{habit.name}</span><strong>{habit.done} из {habit.planned}</strong></div>)}</div>
    <p className="completion-note">Не обязательно менять всё сразу. Ты уже лучше понимаешь, какие маленькие действия подходят твоей жизни.</p>
    <PrimaryButton light onClick={() => void onNext()}>Создать следующий спринт</PrimaryButton>
  </main>;
}

function BottomNav({ tab, setTab }: { tab: Tab; setTab: (tab: Tab) => void }) {
  const items: Array<[Tab, ReactNode, string]> = [['today', <Home />, 'Сегодня'], ['calendar', <CalendarDays />, 'Календарь'], ['progress', <TrendingUp />, 'Прогресс'], ['ideas', <BookOpen />, 'Идеи'], ['more', <MoreHorizontal />, 'Ещё']];
  return <nav className="bottom-nav">{items.map(([value, icon, label]) => <button className={tab === value ? 'active' : ''} key={value} onClick={() => { setTab(value); haptic(); }}>{icon}<span>{label}</span></button>)}</nav>;
}

export function App() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [error, setError] = useState('');
  const refresh = async () => { try { setError(''); setData(await api.bootstrap()); } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось загрузить РИТМ'); } };
  useEffect(() => { void refresh(); }, []);
  if (error) return <ErrorScreen message={error} retry={refresh} />;
  if (!data) return <LoadingScreen />;
  if (!data.sprint) return <Onboarding data={data} onCreated={refresh} />;
  return <Dashboard data={data} refresh={refresh} />;
}
