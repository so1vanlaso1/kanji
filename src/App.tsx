import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import kanjiCsv from '../kanji.csv?raw'

type KanjiCard = {
  id: number
  kanji: string
  hanViet: string
}

type Mode = 'learn' | 'test'
type CardStatus = 'new' | 'learning' | 'known'

const parseKanjiCsv = (csv: string): KanjiCard[] =>
  csv
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line, index) => {
      const [kanji, ...rest] = line.split(',')
      return {
        id: index,
        kanji: kanji.trim(),
        hanViet: rest.join(',').trim(),
      }
    })
    .filter((card) => card.kanji && card.hanViet)

const stripVietnameseTone = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u0111\u0110]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const shuffleCards = (cards: KanjiCard[]) => {
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

const cards = parseKanjiCsv(kanjiCsv)

const getInitialTheme = () => {
  const savedTheme = localStorage.getItem('kanji-theme')
  if (savedTheme) return savedTheme === 'dark'

  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

const getInitialStatuses = (): Record<number, CardStatus> => {
  const savedStatuses = localStorage.getItem('kanji-progress')
  return savedStatuses
    ? (JSON.parse(savedStatuses) as Record<number, CardStatus>)
    : {}
}

function App() {
  const [mode, setMode] = useState<Mode>('learn')
  const [isDark, setIsDark] = useState(getInitialTheme)
  const [query, setQuery] = useState('')
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isFlipped, setIsFlipped] = useState(false)
  const [statuses, setStatuses] = useState<Record<number, CardStatus>>(
    getInitialStatuses,
  )
  const [learnQueue, setLearnQueue] = useState<KanjiCard[]>(() =>
    shuffleCards(cards),
  )
  const [testQueue, setTestQueue] = useState<KanjiCard[]>(() => shuffleCards(cards))
  const [testIndex, setTestIndex] = useState(0)
  const [answer, setAnswer] = useState('')
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null)
  const [score, setScore] = useState({ correct: 0, total: 0 })
  const [missed, setMissed] = useState<KanjiCard[]>([])

  useEffect(() => {
    localStorage.setItem('kanji-theme', isDark ? 'dark' : 'light')
  }, [isDark])

  useEffect(() => {
    localStorage.setItem('kanji-progress', JSON.stringify(statuses))
  }, [statuses])

  const filteredCards = useMemo(() => {
    const normalizedQuery = stripVietnameseTone(query)

    return cards.filter((card) => {
      if (!normalizedQuery) return true
      return (
        card.kanji.includes(query.trim()) ||
        stripVietnameseTone(card.hanViet).includes(normalizedQuery)
      )
    })
  }, [query])

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

  useEffect(() => {
    setCurrentIndex((index) =>
      pendingLearnCards.length
        ? Math.min(index, pendingLearnCards.length - 1)
        : 0,
    )
  }, [pendingLearnCards.length])

  const effectiveIndex = pendingLearnCards.length
    ? Math.min(currentIndex, pendingLearnCards.length - 1)
    : 0
  const currentCard = pendingLearnCards[effectiveIndex] ?? cards[0]
  const currentTestCard = testQueue[testIndex]
  const knownCount = cards.filter((card) => statuses[card.id] === 'known').length
  const learningCount = cards.filter(
    (card) => statuses[card.id] === 'learning',
  ).length
  const testFinished = testIndex >= testQueue.length
  const accuracy = score.total ? Math.round((score.correct / score.total) * 100) : 0
  const progressPercent = cards.length ? Math.round((knownCount / cards.length) * 100) : 0

  const setCardStatus = (card: KanjiCard, status: CardStatus) => {
    setStatuses((previous) => ({ ...previous, [card.id]: status }))
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

  const markStillLearning = (card: KanjiCard) => {
    setCardStatus(card, 'learning')
    setLearnQueue((queue) => {
      const remaining = queue.filter((item) => item.id !== card.id)
      const insertAt = Math.min(currentIndex + 4, remaining.length)

      return [
        ...remaining.slice(0, insertAt),
        card,
        ...remaining.slice(insertAt),
      ]
    })
    setIsFlipped(false)
  }

  const markKnown = (card: KanjiCard) => {
    setCardStatus(card, 'known')
    setIsFlipped(false)
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

    setTestQueue(shuffleCards(sourceCards.length ? sourceCards : cards))
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

  return (
    <main
      className={`${isDark ? 'dark' : ''} min-h-screen bg-[#fbf9f7] text-[#16171d] transition-colors dark:bg-[#101116] dark:text-[#f3f0ea]`}
    >
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col border-x border-[#ded8cf] bg-[#fffdf9]/80 shadow-[0_24px_80px_rgba(22,23,29,0.08)] backdrop-blur dark:border-[#292c35] dark:bg-[#14161d]/86">
        <header className="sticky top-0 z-20 border-b border-[#ded8cf] bg-[#fffdf9]/92 backdrop-blur dark:border-[#292c35] dark:bg-[#14161d]/92">
          <div className="flex flex-col gap-4 px-5 py-4 md:flex-row md:items-center md:justify-between md:px-8">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.28em] text-[#9b2f2f] dark:text-[#e3a66d]">
                Kanji Memory Desk
              </p>
              <h1 className="mt-1 font-vietnamese text-3xl font-bold leading-tight md:text-4xl">
                Han Viet recall trainer
              </h1>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setMode('learn')}
                className={`rounded-none border px-4 py-2 text-sm font-semibold transition ${
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
                className={`rounded-none border px-4 py-2 text-sm font-semibold transition ${
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
                className="rounded-none border border-[#ded8cf] px-4 py-2 text-sm font-semibold transition hover:border-[#16171d] dark:border-[#343844] dark:hover:border-[#f3f0ea]"
              >
                {isDark ? 'Light' : 'Dark'}
              </button>
            </div>
          </div>
        </header>

        <section className="grid gap-0 border-b border-[#ded8cf] dark:border-[#292c35] lg:grid-cols-[1.4fr_0.9fr]">
          <div className="border-b border-[#ded8cf] px-5 py-6 dark:border-[#292c35] md:px-8 lg:border-b-0 lg:border-r">
            <div className="max-w-3xl">
              <p className="font-mono text-xs uppercase tracking-[0.28em] text-[#77716b] dark:text-[#a6a29b]">
                {cards.length} characters from kanji.csv
              </p>
              <h2 className="mt-4 font-vietnamese text-4xl font-bold leading-[1.04] md:text-6xl">
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
            <div className="flex min-h-[560px] flex-col px-5 py-6 md:px-8">
              <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="font-mono text-xs uppercase tracking-[0.24em] text-[#77716b] dark:text-[#a6a29b]">
                    Learn mode
                  </p>
                  <p className="mt-1 text-sm text-[#625d57] dark:text-[#bab5ad]">
                    Shuffled review keeps missed cards in rotation until learned.
                  </p>
                </div>
                <div className="flex w-full flex-col gap-2 sm:flex-row md:w-auto">
                  <button
                    type="button"
                    onClick={shuffleLearning}
                    className="h-11 border border-[#ded8cf] px-4 text-sm font-semibold transition hover:border-[#16171d] dark:border-[#343844] dark:hover:border-[#f3f0ea]"
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
                    className="h-11 w-full border border-[#d8d1c7] bg-white px-4 text-sm outline-none transition placeholder:text-[#9b948c] focus:border-[#16171d] dark:border-[#343844] dark:bg-[#101116] dark:placeholder:text-[#746f6b] dark:focus:border-[#f3f0ea] md:w-72"
                  />
                </div>
              </div>

              {pendingLearnCards.length ? (
                <button
                  type="button"
                  onClick={() => setIsFlipped((value) => !value)}
                  className="group grid min-h-[330px] flex-1 place-items-center border border-[#16171d] bg-[#fbf9f7] px-6 py-10 text-center transition hover:bg-white dark:border-[#f3f0ea] dark:bg-[#101116] dark:hover:bg-[#171a22]"
                >
                  <div>
                    <p className="font-mono text-xs uppercase tracking-[0.3em] text-[#9b2f2f] dark:text-[#e3a66d]">
                      Queue {effectiveIndex + 1} of {pendingLearnCards.length}
                    </p>
                    <div
                      className={`mt-6 leading-none ${
                        isFlipped
                          ? 'font-vietnamese text-6xl font-bold md:text-8xl'
                          : 'font-kanji text-[8rem] font-bold md:text-[11rem]'
                      }`}
                    >
                      {isFlipped ? currentCard.hanViet : currentCard.kanji}
                    </div>
                    <p className="mt-7 text-sm text-[#625d57] dark:text-[#bab5ad]">
                      {isFlipped ? (
                        <span className="font-kanji">{currentCard.kanji}</span>
                      ) : (
                        'Reveal Han Viet'
                      )}
                    </p>
                  </div>
                </button>
              ) : (
                <div className="grid min-h-[330px] flex-1 place-items-center border border-[#16171d] bg-[#fbf9f7] px-6 py-10 text-center dark:border-[#f3f0ea] dark:bg-[#101116]">
                  <div className="max-w-xl">
                    <p className="font-mono text-xs uppercase tracking-[0.3em] text-[#9b2f2f] dark:text-[#e3a66d]">
                      Learning complete
                    </p>
                    <h2 className="font-vietnamese mt-5 text-5xl font-bold leading-tight">
                      {filteredCards.length
                        ? 'You learned every card in this set.'
                        : 'No cards match this search.'}
                    </h2>
                    <p className="mt-4 text-[#625d57] dark:text-[#bab5ad]">
                      Known cards leave the learning queue. Cards marked still
                      learning come back later until you mark them known.
                    </p>
                    <div className="mt-7 grid gap-3 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => setQuery('')}
                        className="border border-[#ded8cf] px-5 py-3 text-sm font-semibold transition hover:border-[#16171d] dark:border-[#343844] dark:hover:border-[#f3f0ea]"
                      >
                        Clear search
                      </button>
                      <button
                        type="button"
                        onClick={restartLearning}
                        className="border border-[#16171d] bg-[#16171d] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#2a2c34] dark:border-[#f3f0ea] dark:bg-[#f3f0ea] dark:text-[#101116]"
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
                  className="border border-[#ded8cf] px-5 py-3 text-sm font-semibold transition hover:border-[#16171d] dark:border-[#343844] dark:hover:border-[#f3f0ea]"
                >
                  Previous
                </button>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => markStillLearning(currentCard)}
                    disabled={!pendingLearnCards.length}
                    className="border border-[#c9a44a] bg-[#fff7df] px-5 py-3 text-sm font-semibold text-[#6f5210] transition hover:bg-[#ffefbd] dark:border-[#806729] dark:bg-[#2a2415] dark:text-[#f2d27d]"
                  >
                    Still learning
                  </button>
                  <button
                    type="button"
                    onClick={() => markKnown(currentCard)}
                    disabled={!pendingLearnCards.length}
                    className="border border-[#1f6f54] bg-[#e7f6ed] px-5 py-3 text-sm font-semibold text-[#17523f] transition hover:bg-[#d4f0df] dark:border-[#39765f] dark:bg-[#13251e] dark:text-[#aee6cd]"
                  >
                    I know this
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => moveCard(1)}
                  disabled={!pendingLearnCards.length}
                  className="border border-[#ded8cf] px-5 py-3 text-sm font-semibold transition hover:border-[#16171d] dark:border-[#343844] dark:hover:border-[#f3f0ea]"
                >
                  Next
                </button>
              </div>
            </div>

            <aside className="border-t border-[#ded8cf] bg-[#f2eee8] dark:border-[#292c35] dark:bg-[#11131a] lg:border-l lg:border-t-0">
              <div className="border-b border-[#ded8cf] px-5 py-4 dark:border-[#292c35]">
                <p className="font-mono text-xs uppercase tracking-[0.24em] text-[#77716b] dark:text-[#a6a29b]">
                  Study queue
                </p>
              </div>
              <div className="grid max-h-[620px] grid-cols-2 overflow-auto">
                {pendingLearnCards.map((card, index) => (
                  <button
                    type="button"
                    key={card.id}
                    onClick={() => {
                      setCurrentIndex(index)
                      setIsFlipped(false)
                    }}
                    className={`border-b border-r border-[#ded8cf] px-4 py-3 text-left transition dark:border-[#292c35] ${
                      currentCard.id === card.id
                        ? 'bg-[#16171d] text-white dark:bg-[#f3f0ea] dark:text-[#101116]'
                        : 'hover:bg-white dark:hover:bg-[#191c25]'
                    }`}
                  >
                    <span className="font-kanji block text-3xl font-bold">
                      {card.kanji}
                    </span>
                    <span className="font-vietnamese mt-1 block text-xs">
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
            <div className="flex min-h-[560px] flex-col px-5 py-6 md:px-8">
              {!testFinished && currentTestCard ? (
                <>
                  <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="font-mono text-xs uppercase tracking-[0.24em] text-[#77716b] dark:text-[#a6a29b]">
                        Test mode
                      </p>
                      <p className="mt-1 text-sm text-[#625d57] dark:text-[#bab5ad]">
                        Type the Vietnamese Han Viet reading for the kanji.
                      </p>
                    </div>
                    <p className="font-mono text-sm text-[#625d57] dark:text-[#bab5ad]">
                      {testIndex + 1}/{testQueue.length}
                    </p>
                  </div>

                  <div className="grid flex-1 place-items-center border border-[#16171d] bg-[#fbf9f7] px-6 py-10 text-center dark:border-[#f3f0ea] dark:bg-[#101116]">
                    <div className="w-full max-w-xl">
                      <p className="font-mono text-xs uppercase tracking-[0.3em] text-[#9b2f2f] dark:text-[#e3a66d]">
                        Write Han Viet
                      </p>
                      <div className="font-kanji mt-6 text-[9rem] font-bold leading-none md:text-[12rem]">
                        {currentTestCard.kanji}
                      </div>

                      <form onSubmit={submitAnswer} className="mt-8">
                        <input
                          value={answer}
                          onChange={(event) => setAnswer(event.target.value)}
                          disabled={Boolean(feedback)}
                          autoFocus
                          placeholder="Example: nhat"
                          className="h-14 w-full border border-[#d8d1c7] bg-white px-5 text-center text-xl outline-none transition placeholder:text-[#9b948c] focus:border-[#16171d] disabled:opacity-70 dark:border-[#343844] dark:bg-[#14161d] dark:placeholder:text-[#746f6b] dark:focus:border-[#f3f0ea]"
                        />
                        <button
                          type={feedback ? 'button' : 'submit'}
                          onClick={feedback ? nextQuestion : undefined}
                          className="mt-4 w-full border border-[#16171d] bg-[#16171d] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#2a2c34] dark:border-[#f3f0ea] dark:bg-[#f3f0ea] dark:text-[#101116] dark:hover:bg-white"
                        >
                          {feedback ? 'Next question' : 'Check answer'}
                        </button>
                      </form>

                      {feedback && (
                        <div
                          className={`mt-5 border px-5 py-4 text-left ${
                            feedback === 'correct'
                              ? 'border-[#1f6f54] bg-[#e7f6ed] text-[#17523f] dark:border-[#39765f] dark:bg-[#13251e] dark:text-[#aee6cd]'
                              : 'border-[#9b2f2f] bg-[#f8e8e5] text-[#79201f] dark:border-[#8e4942] dark:bg-[#2a1717] dark:text-[#f0b5af]'
                          }`}
                        >
                          <p className="font-semibold">
                            {feedback === 'correct' ? 'Correct' : 'Not quite'}
                          </p>
                          <p className="mt-1 text-sm">
                            Answer: <span className="font-semibold">{currentTestCard.hanViet}</span>
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div className="grid flex-1 place-items-center border border-[#16171d] bg-[#fbf9f7] px-6 py-10 text-center dark:border-[#f3f0ea] dark:bg-[#101116]">
                  <div className="max-w-xl">
                    <p className="font-mono text-xs uppercase tracking-[0.3em] text-[#9b2f2f] dark:text-[#e3a66d]">
                      Test complete
                    </p>
                    <h2 className="font-vietnamese mt-5 text-5xl font-bold leading-tight">
                      {score.correct} correct out of {score.total}
                    </h2>
                    <p className="mt-4 text-[#625d57] dark:text-[#bab5ad]">
                      Accuracy: {accuracy}%. Missed cards are ready for a focused retry.
                    </p>
                    <div className="mt-7 grid gap-3 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => resetTest()}
                        className="border border-[#16171d] bg-[#16171d] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#2a2c34] dark:border-[#f3f0ea] dark:bg-[#f3f0ea] dark:text-[#101116]"
                      >
                        Test active queue
                      </button>
                      <button
                        type="button"
                        disabled={!missed.length}
                        onClick={() => resetTest(missed)}
                        className="border border-[#ded8cf] px-5 py-3 text-sm font-semibold transition hover:border-[#16171d] disabled:cursor-not-allowed disabled:opacity-45 dark:border-[#343844] dark:hover:border-[#f3f0ea]"
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
              <div className="px-5 py-5">
                <p className="font-mono text-xs uppercase tracking-[0.24em] text-[#77716b] dark:text-[#a6a29b]">
                  Answer rules
                </p>
                <ul className="mt-4 space-y-3 text-sm text-[#625d57] dark:text-[#bab5ad]">
                  <li>Vietnamese accents are accepted but not required.</li>
                  <li>Correct answers become known cards automatically.</li>
                  <li>Wrong answers stay in learning for later review.</li>
                </ul>
              </div>
              <div className="border-t border-[#ded8cf] px-5 py-5 dark:border-[#292c35]">
                <p className="font-mono text-xs uppercase tracking-[0.24em] text-[#77716b] dark:text-[#a6a29b]">
                  Missed
                </p>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {missed.slice(-12).map((card, index) => (
                    <div
                      key={`${card.id}-${index}`}
                      className="border border-[#ded8cf] bg-white px-3 py-2 dark:border-[#292c35] dark:bg-[#171a22]"
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
    <div className={`${compact ? 'px-4 py-5' : 'px-5 py-8'} text-center`}>
      <p className="font-mono text-[0.68rem] uppercase tracking-[0.22em] text-[#77716b] dark:text-[#a6a29b]">
        {label}
      </p>
      <p className="font-vietnamese mt-2 text-4xl font-bold leading-none">
        {value}
      </p>
    </div>
  )
}

export default App
