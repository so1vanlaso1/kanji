import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, PointerEvent } from 'react'

type KanjiCard = {
  id: string
  kanji: string
  hanViet: string
  meaning: string
}

type Lesson = {
  id: string
  name: string
  fileName: string
  cards: KanjiCard[]
}

type Mode = 'learn' | 'test'
type CardStatus = 'new' | 'learning' | 'known'

const csvModules = import.meta.glob('../lesson/*.csv', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>

const stripVietnameseTone = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u0111\u0110]/g, 'd')
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const normalizeHeader = (value: string) =>
  stripVietnameseTone(value).replace(/[^a-z0-9]/g, '')

const parseCsvRows = (csv: string) => {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index]
    const nextChar = csv[index + 1]

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        cell += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      row.push(cell.trim())
      cell = ''
      continue
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') index += 1
      row.push(cell.trim())
      if (row.some(Boolean)) rows.push(row)
      row = []
      cell = ''
      continue
    }

    cell += char
  }

  row.push(cell.trim())
  if (row.some(Boolean)) rows.push(row)

  return rows
}

const parseKanjiCsv = (csv: string, lessonId: string): KanjiCard[] => {
  const rows = parseCsvRows(csv)
  if (!rows.length) return []

  const headers = rows[0].map(normalizeHeader)
  const hasHeader = headers.includes('kanji') || headers.includes('hanviet')
  const kanjiIndex = hasHeader ? headers.indexOf('kanji') : 0
  const hanVietIndex = hasHeader ? headers.indexOf('hanviet') : 1
  const meaningIndex = hasHeader
    ? headers.findIndex((header) =>
        ['nghia', 'meaning', 'meanings'].includes(header),
      )
    : 2
  const dataRows = hasHeader ? rows.slice(1) : rows
  const safeKanjiIndex = kanjiIndex >= 0 ? kanjiIndex : 0
  const safeHanVietIndex = hanVietIndex >= 0 ? hanVietIndex : 1
  const safeMeaningIndex = meaningIndex >= 0 ? meaningIndex : 2

  return dataRows
    .map((row, index) => ({
      id: `${lessonId}-${index}`,
      kanji: row[safeKanjiIndex]?.trim() ?? '',
      hanViet: row[safeHanVietIndex]?.trim() ?? '',
      meaning: row[safeMeaningIndex]?.trim() ?? '',
    }))
    .filter((card) => card.kanji && card.hanViet)
}

const getFileName = (path: string) => path.split('/').pop() ?? path

const getLessonName = (fileName: string) =>
  fileName
    .replace(/\.csv$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim()

const lessons: Lesson[] = Object.entries(csvModules)
  .map(([path, csv]) => {
    const fileName = getFileName(path)
    const id = fileName.replace(/\.csv$/i, '')

    return {
      id,
      name: getLessonName(fileName),
      fileName,
      cards: parseKanjiCsv(csv, id),
    }
  })
  .filter((lesson) => lesson.cards.length)
  .sort((a, b) =>
    a.name.localeCompare(b.name, undefined, {
      numeric: true,
      sensitivity: 'base',
    }),
  )

const emptyCards: KanjiCard[] = []

const shuffleCards = <T,>(cards: T[]) => {
  const shuffled = [...cards]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const nextIndex = Math.floor(Math.random() * (index + 1))
    ;[shuffled[index], shuffled[nextIndex]] = [
      shuffled[nextIndex],
      shuffled[index],
    ]
  }
  return shuffled
}

const getProgressKey = (lessonId: string) => `kanji-progress:${lessonId}`

const getSavedStatuses = (lessonId: string): Record<string, CardStatus> => {
  try {
    const savedStatuses = localStorage.getItem(getProgressKey(lessonId))
    return savedStatuses
      ? (JSON.parse(savedStatuses) as Record<string, CardStatus>)
      : {}
  } catch {
    return {}
  }
}

const getInitialTheme = () => {
  const savedTheme = localStorage.getItem('kanji-theme')
  if (savedTheme) return savedTheme === 'dark'

  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

const getInitialLessonId = () => {
  const savedLessonId = localStorage.getItem('kanji-active-lesson')
  const savedLesson = lessons.find((lesson) => lesson.id === savedLessonId)

  return savedLesson?.id ?? lessons[0]?.id ?? ''
}

function App() {
  const [mode, setMode] = useState<Mode>('learn')
  const [isDark, setIsDark] = useState(getInitialTheme)
  const [lessonId, setLessonId] = useState(getInitialLessonId)
  const activeLesson = useMemo(
    () => lessons.find((lesson) => lesson.id === lessonId) ?? lessons[0],
    [lessonId],
  )
  const cards = activeLesson?.cards ?? emptyCards
  const [query, setQuery] = useState('')
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isFlipped, setIsFlipped] = useState(false)
  const [statuses, setStatuses] = useState<Record<string, CardStatus>>(() =>
    activeLesson ? getSavedStatuses(activeLesson.id) : {},
  )
  const [learnQueue, setLearnQueue] = useState<KanjiCard[]>(() =>
    shuffleCards(cards),
  )
  const [testQueue, setTestQueue] = useState<KanjiCard[]>(() =>
    shuffleCards(cards),
  )
  const [testIndex, setTestIndex] = useState(0)
  const [answer, setAnswer] = useState('')
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null)
  const [score, setScore] = useState({ correct: 0, total: 0 })
  const [missed, setMissed] = useState<KanjiCard[]>([])
  const swipeStartRef = useRef({ x: 0, y: 0 })
  const didSwipeRef = useRef(false)
  const [swipeDelta, setSwipeDelta] = useState(0)

  useEffect(() => {
    localStorage.setItem('kanji-theme', isDark ? 'dark' : 'light')
  }, [isDark])

  useEffect(() => {
    if (!activeLesson) return
    localStorage.setItem(getProgressKey(activeLesson.id), JSON.stringify(statuses))
  }, [activeLesson, statuses])

  const filteredCards = useMemo(() => {
    const normalizedQuery = stripVietnameseTone(query)

    return cards.filter((card) => {
      if (!normalizedQuery) return true
      return (
        card.kanji.includes(query.trim()) ||
        stripVietnameseTone(card.hanViet).includes(normalizedQuery)
      )
    })
  }, [cards, query])

  const filteredCardIds = useMemo(
    () => new Set(filteredCards.map((card) => card.id)),
    [filteredCards],
  )
  const pendingLearnCards = useMemo(
    () =>
      learnQueue.filter(
        (card) =>
          filteredCardIds.has(card.id) && statuses[card.id] !== 'known',
      ),
    [filteredCardIds, learnQueue, statuses],
  )

  const effectiveIndex = pendingLearnCards.length
    ? Math.min(currentIndex, pendingLearnCards.length - 1)
    : 0
  const currentCard = pendingLearnCards[effectiveIndex]
  const currentTestCard = testQueue[testIndex]
  const knownCount = cards.filter((card) => statuses[card.id] === 'known').length
  const learningCount = cards.filter(
    (card) => statuses[card.id] === 'learning',
  ).length
  const testFinished = testIndex >= testQueue.length
  const accuracy = score.total ? Math.round((score.correct / score.total) * 100) : 0
  const progressPercent = cards.length
    ? Math.round((knownCount / cards.length) * 100)
    : 0

  const setCardStatus = (card: KanjiCard, status: CardStatus) => {
    setStatuses((previous) => ({ ...previous, [card.id]: status }))
  }

  const chooseLesson = (nextLessonId: string) => {
    const nextLesson = lessons.find((lesson) => lesson.id === nextLessonId)
    if (!nextLesson) return

    localStorage.setItem('kanji-active-lesson', nextLesson.id)
    setLessonId(nextLesson.id)
    setStatuses(getSavedStatuses(nextLesson.id))
    setLearnQueue(shuffleCards(nextLesson.cards))
    setTestQueue(shuffleCards(nextLesson.cards))
    setQuery('')
    setCurrentIndex(0)
    setIsFlipped(false)
    setTestIndex(0)
    setAnswer('')
    setFeedback(null)
    setScore({ correct: 0, total: 0 })
    setMissed([])
    setMode('learn')
  }

  const moveCard = (direction: 1 | -1) => {
    setCurrentIndex((index) => {
      const nextIndex = index + direction
      if (!pendingLearnCards.length) return 0
      if (nextIndex < 0) return pendingLearnCards.length - 1
      if (nextIndex >= pendingLearnCards.length) return 0
      return nextIndex
    })
    setIsFlipped(false)
  }

  const shuffleLearning = () => {
    setLearnQueue(shuffleCards(cards))
    setCurrentIndex(0)
    setIsFlipped(false)
  }

  const markNotLearned = (card?: KanjiCard) => {
    if (!card) return

    const wasLastVisibleCard =
      pendingLearnCards[pendingLearnCards.length - 1]?.id === card.id

    setCardStatus(card, 'learning')
    setLearnQueue((queue) => [
      ...queue.filter((item) => item.id !== card.id),
      card,
    ])
    setCurrentIndex(wasLastVisibleCard ? 0 : effectiveIndex)
    setIsFlipped(false)
  }

  const markKnown = (card?: KanjiCard) => {
    if (!card) return

    setCardStatus(card, 'known')
    setIsFlipped(false)
  }

  const startCardSwipe = (event: PointerEvent<HTMLButtonElement>) => {
    if (!currentCard || event.pointerType === 'mouse') return

    swipeStartRef.current = { x: event.clientX, y: event.clientY }
    didSwipeRef.current = false
    setSwipeDelta(0)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const trackCardSwipe = (event: PointerEvent<HTMLButtonElement>) => {
    if (!currentCard || event.pointerType === 'mouse') return

    const nextDelta = event.clientX - swipeStartRef.current.x
    setSwipeDelta(Math.max(-96, Math.min(96, nextDelta)))
  }

  const finishCardSwipe = (event: PointerEvent<HTMLButtonElement>) => {
    if (!currentCard || event.pointerType === 'mouse') return

    const deltaX = event.clientX - swipeStartRef.current.x
    const deltaY = event.clientY - swipeStartRef.current.y
    const isHorizontalSwipe = Math.abs(deltaX) > 72 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2

    if (isHorizontalSwipe) {
      didSwipeRef.current = true
      if (deltaX < 0) {
        markNotLearned(currentCard)
      } else {
        markKnown(currentCard)
      }
    }

    setSwipeDelta(0)
  }

  const flipCurrentCard = () => {
    if (didSwipeRef.current) {
      didSwipeRef.current = false
      return
    }

    setIsFlipped((value) => !value)
  }

  const restartLearning = () => {
    setStatuses({})
    setLearnQueue(shuffleCards(cards))
    setCurrentIndex(0)
    setIsFlipped(false)
  }

  const resetTest = (pool?: KanjiCard[]) => {
    const activeCards = cards.filter((card) => statuses[card.id] !== 'known')
    const sourceCards = pool ?? (activeCards.length ? activeCards : cards)

    setTestQueue(shuffleCards(sourceCards))
    setTestIndex(0)
    setAnswer('')
    setFeedback(null)
    setScore({ correct: 0, total: 0 })
    setMissed([])
    setMode('test')
  }

  const submitAnswer = (event: FormEvent) => {
    event.preventDefault()
    if (!currentTestCard || feedback || !answer.trim()) return

    const isCorrect =
      stripVietnameseTone(answer) === stripVietnameseTone(currentTestCard.hanViet)

    setFeedback(isCorrect ? 'correct' : 'wrong')
    setScore((previous) => ({
      correct: previous.correct + (isCorrect ? 1 : 0),
      total: previous.total + 1,
    }))

    if (isCorrect) {
      setCardStatus(currentTestCard, 'known')
    } else {
      setCardStatus(currentTestCard, 'learning')
      setMissed((previous) =>
        previous.some((card) => card.id === currentTestCard.id)
          ? previous
          : [...previous, currentTestCard],
      )
    }
  }

  const nextQuestion = () => {
    setTestIndex((index) => index + 1)
    setAnswer('')
    setFeedback(null)
  }

  if (!activeLesson) {
    return (
      <main
        className={`${isDark ? 'dark' : ''} grid min-h-screen place-items-center bg-[#fbf9f7] px-5 text-[#16171d] dark:bg-[#101116] dark:text-[#f3f0ea]`}
      >
        <div className="max-w-xl border border-[#ded8cf] bg-[#fffdf9] p-6 text-center dark:border-[#292c35] dark:bg-[#14161d]">
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-[#9b2f2f] dark:text-[#e3a66d]">
            No lessons found
          </p>
          <h1 className="font-vietnamese mt-4 text-3xl font-bold">
            Add CSV files to the lesson folder.
          </h1>
          <p className="mt-3 text-sm text-[#625d57] dark:text-[#bab5ad]">
            Each file should include Kanji and HanViet columns.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main
      className={`${isDark ? 'dark' : ''} min-h-screen bg-[#fbf9f7] text-[#16171d] transition-colors dark:bg-[#101116] dark:text-[#f3f0ea]`}
    >
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col bg-[#fffdf9]/80 shadow-[0_24px_80px_rgba(22,23,29,0.08)] backdrop-blur dark:bg-[#14161d]/86 md:border-x md:border-[#ded8cf] md:dark:border-[#292c35]">
        <header className="sticky top-0 z-20 border-b border-[#ded8cf] bg-[#fffdf9]/92 backdrop-blur dark:border-[#292c35] dark:bg-[#14161d]/92">
          <div className="flex flex-col gap-4 px-4 py-4 sm:px-5 md:flex-row md:items-center md:justify-between md:px-8">
            <div>
              <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-[#9b2f2f] dark:text-[#e3a66d] sm:text-xs sm:tracking-[0.28em]">
                Kanji Memory Desk
              </p>
              <h1 className="mt-1 font-vietnamese text-2xl font-bold leading-tight sm:text-3xl md:text-4xl">
                Han Viet recall trainer
              </h1>
            </div>

            <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:items-center">
              <button
                type="button"
                onClick={() => setMode('learn')}
                className={`min-h-11 border px-3 text-sm font-semibold transition sm:px-4 ${
                  mode === 'learn'
                    ? 'border-[#16171d] bg-[#16171d] text-white dark:border-[#f3f0ea] dark:bg-[#f3f0ea] dark:text-[#101116]'
                    : 'border-[#ded8cf] bg-transparent hover:border-[#16171d] dark:border-[#343844] dark:hover:border-[#f3f0ea]'
                }`}
              >
                Learn
              </button>
              <button
                type="button"
                onClick={() => resetTest()}
                disabled={!cards.length}
                className={`min-h-11 border px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-45 sm:px-4 ${
                  mode === 'test'
                    ? 'border-[#16171d] bg-[#16171d] text-white dark:border-[#f3f0ea] dark:bg-[#f3f0ea] dark:text-[#101116]'
                    : 'border-[#ded8cf] bg-transparent hover:border-[#16171d] dark:border-[#343844] dark:hover:border-[#f3f0ea]'
                }`}
              >
                Test
              </button>
              <button
                type="button"
                onClick={() => setIsDark((value) => !value)}
                className="min-h-11 border border-[#ded8cf] px-3 text-sm font-semibold transition hover:border-[#16171d] dark:border-[#343844] dark:hover:border-[#f3f0ea] sm:px-4"
              >
                {isDark ? 'Light' : 'Dark'}
              </button>
            </div>
          </div>
        </header>

        <section className="grid gap-0 border-b border-[#ded8cf] dark:border-[#292c35] lg:grid-cols-[1.35fr_0.9fr]">
          <div className="border-b border-[#ded8cf] px-4 py-5 dark:border-[#292c35] sm:px-5 md:px-8 lg:border-b-0 lg:border-r">
            <div className="max-w-3xl">
              <label
                htmlFor="lesson"
                className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-[#77716b] dark:text-[#a6a29b] sm:text-xs sm:tracking-[0.28em]"
              >
                Lesson
              </label>
              <select
                id="lesson"
                value={activeLesson.id}
                onChange={(event) => chooseLesson(event.target.value)}
                className="mt-3 h-12 w-full border border-[#d8d1c7] bg-white px-4 text-base font-semibold outline-none transition focus:border-[#16171d] dark:border-[#343844] dark:bg-[#101116] dark:focus:border-[#f3f0ea] sm:max-w-sm"
              >
                {lessons.map((lesson) => (
                  <option key={lesson.id} value={lesson.id}>
                    {lesson.name}
                  </option>
                ))}
              </select>
              <p className="mt-4 font-mono text-xs uppercase tracking-[0.2em] text-[#77716b] dark:text-[#a6a29b]">
                {cards.length} characters from {activeLesson.fileName}
              </p>
              <h2 className="mt-4 font-vietnamese text-[2.35rem] font-bold leading-[1.04] sm:text-5xl md:text-6xl">
                Remember the character first. Recall the Vietnamese reading next.
              </h2>
            </div>
          </div>

          <div className="grid grid-cols-3 divide-x divide-[#ded8cf] dark:divide-[#292c35]">
            <Stat label="Known" value={knownCount} />
            <Stat label="Learning" value={learningCount} />
            <Stat label="Progress" value={`${progressPercent}%`} />
          </div>
        </section>

        {mode === 'learn' ? (
          <section className="grid flex-1 gap-0 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="flex min-h-[calc(100svh-320px)] flex-col px-4 py-5 sm:px-5 md:px-8 md:py-6 lg:min-h-[560px]">
              <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="font-mono text-xs uppercase tracking-[0.24em] text-[#77716b] dark:text-[#a6a29b]">
                    Learn mode
                  </p>
                  <p className="mt-1 text-sm text-[#625d57] dark:text-[#bab5ad]">
                    Not learned cards move to the back of the queue.
                  </p>
                </div>
                <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-[auto_1fr] md:w-auto">
                  <button
                    type="button"
                    onClick={shuffleLearning}
                    className="min-h-11 border border-[#ded8cf] px-4 text-sm font-semibold transition hover:border-[#16171d] dark:border-[#343844] dark:hover:border-[#f3f0ea]"
                  >
                    Shuffle
                  </button>
                  <input
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value)
                      setCurrentIndex(0)
                      setIsFlipped(false)
                    }}
                    placeholder="Search kanji or Han Viet"
                    className="min-h-11 w-full border border-[#d8d1c7] bg-white px-4 text-base outline-none transition placeholder:text-[#9b948c] focus:border-[#16171d] dark:border-[#343844] dark:bg-[#101116] dark:placeholder:text-[#746f6b] dark:focus:border-[#f3f0ea] md:w-72"
                  />
                </div>
              </div>

              {pendingLearnCards.length && currentCard ? (
                <button
                  type="button"
                  onClick={flipCurrentCard}
                  onPointerDown={startCardSwipe}
                  onPointerMove={trackCardSwipe}
                  onPointerUp={finishCardSwipe}
                  onPointerCancel={() => setSwipeDelta(0)}
                  style={{
                    transform: `translateX(${swipeDelta}px)`,
                  }}
                  className={`group grid min-h-[280px] flex-1 touch-pan-y place-items-center border border-[#16171d] bg-[#fbf9f7] px-4 py-8 text-center transition hover:bg-white dark:border-[#f3f0ea] dark:bg-[#101116] dark:hover:bg-[#171a22] sm:px-6 md:min-h-[330px] ${
                    swipeDelta < -24
                      ? 'border-[#c9a44a] bg-[#fff7df] dark:bg-[#2a2415]'
                      : swipeDelta > 24
                        ? 'border-[#1f6f54] bg-[#e7f6ed] dark:bg-[#13251e]'
                        : ''
                  }`}
                >
                  <div className="min-w-0">
                    <p className="font-mono text-[0.65rem] uppercase tracking-[0.24em] text-[#9b2f2f] dark:text-[#e3a66d] sm:text-xs sm:tracking-[0.3em]">
                      Queue {effectiveIndex + 1} of {pendingLearnCards.length}
                    </p>
                    <div
                      className={`mt-6 break-words leading-none ${
                        isFlipped
                          ? 'font-vietnamese text-[clamp(3rem,14vw,5.5rem)] font-bold'
                          : 'font-kanji text-[clamp(5.5rem,34vw,11rem)] font-bold'
                      }`}
                    >
                      {isFlipped ? currentCard.hanViet : currentCard.kanji}
                    </div>
                    {isFlipped && currentCard.meaning ? (
                      <p className="mx-auto mt-4 max-w-xl text-base font-semibold leading-relaxed text-[#625d57] dark:text-[#bab5ad] sm:text-lg">
                        {currentCard.meaning}
                      </p>
                    ) : null}
                    
                    <p className="mt-4 font-mono text-[0.62rem] uppercase tracking-[0.18em] text-[#8a837b] dark:text-[#8f8b86]">
                      Swipe left: not learned / right: know it
                    </p>
                  </div>
                </button>
              ) : (
                <div className="grid min-h-[280px] flex-1 place-items-center border border-[#16171d] bg-[#fbf9f7] px-4 py-8 text-center dark:border-[#f3f0ea] dark:bg-[#101116] sm:px-6 md:min-h-[330px]">
                  <div className="max-w-xl">
                    <p className="font-mono text-xs uppercase tracking-[0.3em] text-[#9b2f2f] dark:text-[#e3a66d]">
                      Learning complete
                    </p>
                    <h2 className="font-vietnamese mt-5 text-3xl font-bold leading-tight sm:text-5xl">
                      {filteredCards.length
                        ? 'You learned every card in this lesson.'
                        : 'No cards match this search.'}
                    </h2>
                    <p className="mt-4 text-[#625d57] dark:text-[#bab5ad]">
                      Known cards leave the learning queue. Not learned cards
                      return to the end of the queue.
                    </p>
                    <div className="mt-7 grid gap-3 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => setQuery('')}
                        className="min-h-12 border border-[#ded8cf] px-5 text-sm font-semibold transition hover:border-[#16171d] dark:border-[#343844] dark:hover:border-[#f3f0ea]"
                      >
                        Clear search
                      </button>
                      <button
                        type="button"
                        onClick={restartLearning}
                        className="min-h-12 border border-[#16171d] bg-[#16171d] px-5 text-sm font-semibold text-white transition hover:bg-[#2a2c34] dark:border-[#f3f0ea] dark:bg-[#f3f0ea] dark:text-[#101116]"
                      >
                        Study all again
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-5 grid gap-3 md:grid-cols-[auto_1fr_auto] md:items-center">
                <button
                  type="button"
                  onClick={() => moveCard(-1)}
                  disabled={!pendingLearnCards.length}
                  className="min-h-12 border border-[#ded8cf] px-5 text-sm font-semibold transition hover:border-[#16171d] disabled:cursor-not-allowed disabled:opacity-45 dark:border-[#343844] dark:hover:border-[#f3f0ea]"
                >
                  Previous
                </button>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => markNotLearned(currentCard)}
                    disabled={!pendingLearnCards.length}
                    className="min-h-12 border border-[#c9a44a] bg-[#fff7df] px-5 text-sm font-semibold text-[#6f5210] transition hover:bg-[#ffefbd] disabled:cursor-not-allowed disabled:opacity-45 dark:border-[#806729] dark:bg-[#2a2415] dark:text-[#f2d27d]"
                  >
                    Not learned
                  </button>
                  <button
                    type="button"
                    onClick={() => markKnown(currentCard)}
                    disabled={!pendingLearnCards.length}
                    className="min-h-12 border border-[#1f6f54] bg-[#e7f6ed] px-5 text-sm font-semibold text-[#17523f] transition hover:bg-[#d4f0df] disabled:cursor-not-allowed disabled:opacity-45 dark:border-[#39765f] dark:bg-[#13251e] dark:text-[#aee6cd]"
                  >
                    I know this
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => moveCard(1)}
                  disabled={!pendingLearnCards.length}
                  className="min-h-12 border border-[#ded8cf] px-5 text-sm font-semibold transition hover:border-[#16171d] disabled:cursor-not-allowed disabled:opacity-45 dark:border-[#343844] dark:hover:border-[#f3f0ea]"
                >
                  Next
                </button>
              </div>
            </div>

            <aside className="border-t border-[#ded8cf] bg-[#f2eee8] dark:border-[#292c35] dark:bg-[#11131a] lg:border-l lg:border-t-0">
              <div className="border-b border-[#ded8cf] px-4 py-4 dark:border-[#292c35] sm:px-5">
                <p className="font-mono text-xs uppercase tracking-[0.24em] text-[#77716b] dark:text-[#a6a29b]">
                  Study queue
                </p>
              </div>
              <div className="grid max-h-[48svh] grid-cols-2 overflow-auto sm:grid-cols-3 lg:max-h-[620px] lg:grid-cols-2">
                {pendingLearnCards.map((card, index) => (
                  <button
                    type="button"
                    key={card.id}
                    onClick={() => {
                      setCurrentIndex(index)
                      setIsFlipped(false)
                    }}
                    className={`min-h-[88px] border-b border-r border-[#ded8cf] px-3 py-3 text-left transition dark:border-[#292c35] sm:px-4 ${
                      currentCard?.id === card.id
                        ? 'bg-[#16171d] text-white dark:bg-[#f3f0ea] dark:text-[#101116]'
                        : 'hover:bg-white dark:hover:bg-[#191c25]'
                    }`}
                  >
                    <span className="font-kanji block text-3xl font-bold">
                      {card.kanji}
                    </span>
                    <span className="font-vietnamese mt-1 block truncate text-xs">
                      {card.hanViet}
                    </span>
                    <span className="mt-2 block font-mono text-[0.62rem] uppercase tracking-[0.18em] opacity-65">
                      {statuses[card.id] === 'learning' ? 'Learning' : 'New'}
                    </span>
                  </button>
                ))}
              </div>
            </aside>
          </section>
        ) : (
          <section className="grid flex-1 gap-0 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="flex min-h-[calc(100svh-320px)] flex-col px-4 py-5 sm:px-5 md:px-8 md:py-6 lg:min-h-[560px]">
              {!testFinished && currentTestCard ? (
                <>
                  <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="font-mono text-xs uppercase tracking-[0.24em] text-[#77716b] dark:text-[#a6a29b]">
                        Test mode
                      </p>
                      <p className="mt-1 text-sm text-[#625d57] dark:text-[#bab5ad]">
                        Type only the Han Viet reading for the kanji.
                      </p>
                    </div>
                    <p className="font-mono text-sm text-[#625d57] dark:text-[#bab5ad]">
                      {testIndex + 1}/{testQueue.length}
                    </p>
                  </div>

                  <div className="grid flex-1 place-items-center border border-[#16171d] bg-[#fbf9f7] px-4 py-8 text-center dark:border-[#f3f0ea] dark:bg-[#101116] sm:px-6 md:py-10">
                    <div className="w-full max-w-xl">
                      <p className="font-mono text-xs uppercase tracking-[0.3em] text-[#9b2f2f] dark:text-[#e3a66d]">
                        Write Han Viet
                      </p>
                      <div className="font-kanji mt-6 text-[clamp(6rem,38vw,12rem)] font-bold leading-none">
                        {currentTestCard.kanji}
                      </div>

                      <form onSubmit={submitAnswer} className="mt-8">
                        <input
                          value={answer}
                          onChange={(event) => setAnswer(event.target.value)}
                          disabled={Boolean(feedback)}
                          autoFocus
                          placeholder="Example: nhat"
                          className="min-h-14 w-full border border-[#d8d1c7] bg-white px-4 text-center text-lg outline-none transition placeholder:text-[#9b948c] focus:border-[#16171d] disabled:opacity-70 dark:border-[#343844] dark:bg-[#14161d] dark:placeholder:text-[#746f6b] dark:focus:border-[#f3f0ea] sm:px-5 sm:text-xl"
                        />
                        <button
                          type={feedback ? 'button' : 'submit'}
                          onClick={feedback ? nextQuestion : undefined}
                          className="mt-4 min-h-12 w-full border border-[#16171d] bg-[#16171d] px-5 text-sm font-semibold text-white transition hover:bg-[#2a2c34] dark:border-[#f3f0ea] dark:bg-[#f3f0ea] dark:text-[#101116] dark:hover:bg-white"
                        >
                          {feedback ? 'Next question' : 'Check answer'}
                        </button>
                      </form>

                      {feedback && (
                        <div
                          className={`mt-5 border px-4 py-4 text-left sm:px-5 ${
                            feedback === 'correct'
                              ? 'border-[#1f6f54] bg-[#e7f6ed] text-[#17523f] dark:border-[#39765f] dark:bg-[#13251e] dark:text-[#aee6cd]'
                              : 'border-[#9b2f2f] bg-[#f8e8e5] text-[#79201f] dark:border-[#8e4942] dark:bg-[#2a1717] dark:text-[#f0b5af]'
                          }`}
                        >
                          <p className="font-semibold">
                            {feedback === 'correct' ? 'Correct' : 'Not quite'}
                          </p>
                          <p className="mt-1 text-sm">
                            Answer:{' '}
                            <span className="font-semibold">
                              {currentTestCard.hanViet}
                            </span>
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div className="grid flex-1 place-items-center border border-[#16171d] bg-[#fbf9f7] px-4 py-8 text-center dark:border-[#f3f0ea] dark:bg-[#101116] sm:px-6 md:py-10">
                  <div className="max-w-xl">
                    <p className="font-mono text-xs uppercase tracking-[0.3em] text-[#9b2f2f] dark:text-[#e3a66d]">
                      Test complete
                    </p>
                    <h2 className="font-vietnamese mt-5 text-3xl font-bold leading-tight sm:text-5xl">
                      {score.correct} correct out of {score.total}
                    </h2>
                    <p className="mt-4 text-[#625d57] dark:text-[#bab5ad]">
                      Accuracy: {accuracy}%. Missed cards are ready for a focused retry.
                    </p>
                    <div className="mt-7 grid gap-3 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => resetTest()}
                        className="min-h-12 border border-[#16171d] bg-[#16171d] px-5 text-sm font-semibold text-white transition hover:bg-[#2a2c34] dark:border-[#f3f0ea] dark:bg-[#f3f0ea] dark:text-[#101116]"
                      >
                        Test active queue
                      </button>
                      <button
                        type="button"
                        disabled={!missed.length}
                        onClick={() => resetTest(missed)}
                        className="min-h-12 border border-[#ded8cf] px-5 text-sm font-semibold transition hover:border-[#16171d] disabled:cursor-not-allowed disabled:opacity-45 dark:border-[#343844] dark:hover:border-[#f3f0ea]"
                      >
                        Retry missed
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <aside className="border-t border-[#ded8cf] bg-[#f2eee8] dark:border-[#292c35] dark:bg-[#11131a] lg:border-l lg:border-t-0">
              <div className="grid grid-cols-2 divide-x divide-[#ded8cf] border-b border-[#ded8cf] dark:divide-[#292c35] dark:border-[#292c35]">
                <Stat label="Score" value={`${score.correct}/${score.total}`} compact />
                <Stat label="Accuracy" value={`${accuracy}%`} compact />
              </div>
              <div className="px-4 py-5 sm:px-5">
                <p className="font-mono text-xs uppercase tracking-[0.24em] text-[#77716b] dark:text-[#a6a29b]">
                  Answer rules
                </p>
                <ul className="mt-4 space-y-3 text-sm text-[#625d57] dark:text-[#bab5ad]">
                  <li>Vietnamese accents are accepted but not required.</li>
                  <li>Only the Han Viet column is checked.</li>
                  <li>Wrong answers stay in learning for later review.</li>
                </ul>
              </div>
              <div className="border-t border-[#ded8cf] px-4 py-5 dark:border-[#292c35] sm:px-5">
                <p className="font-mono text-xs uppercase tracking-[0.24em] text-[#77716b] dark:text-[#a6a29b]">
                  Missed
                </p>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {missed.slice(-12).map((card, index) => (
                    <div
                      key={`${card.id}-${index}`}
                      className="min-h-12 border border-[#ded8cf] bg-white px-3 py-2 dark:border-[#292c35] dark:bg-[#171a22]"
                    >
                      <span className="font-kanji text-2xl font-bold">
                        {card.kanji}
                      </span>
                      <span className="font-vietnamese ml-2 text-xs">
                        {card.hanViet}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </aside>
          </section>
        )}
      </div>
    </main>
  )
}

function Stat({
  label,
  value,
  compact = false,
}: {
  label: string
  value: string | number
  compact?: boolean
}) {
  return (
    <div className={`${compact ? 'px-3 py-5 sm:px-4' : 'px-3 py-6 sm:px-5 sm:py-8'} text-center`}>
      <p className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-[#77716b] dark:text-[#a6a29b] sm:text-[0.68rem] sm:tracking-[0.22em]">
        {label}
      </p>
      <p className="font-vietnamese mt-2 text-2xl font-bold leading-none sm:text-4xl">
        {value}
      </p>
    </div>
  )
}

export default App
