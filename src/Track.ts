import AudioItem from "./AudioItem"
import * as C from "./constants"
import * as U from "./utils"
import type * as T from "./types"

class Track {
  debug = false
  #index: number = 0
  #name: string = ""
  #queue: AudioItem[] = []
  #subtitlesJSON: T.SubtitlesJSON = {}
  defaultAudioOptions: T.AudioOptions = {}
  #getInheritedAudioOptions: () => T.AudioOptions = () => ({})

  #state: T.TrackState = {
    queue: [],
    id: U.uuid(),
    isPlaying: false,
    volume: 1,
    muted: false,
    loop: false,
    autoPlay: false,
    allowDuplicates: false,
  }
  private state_listeners: T.Listener<T.TrackState>[] = []

  #stream: T.TrackStream = {
    audioItemState: null,
    caption: null,
    innerAudioState: null,
  }
  private stream_listeners: T.Listener<T.TrackStream>[] = []
  updateTrackCallback: (trackState: T.TrackState) => void = () => {}

  constructor(
    args: Partial<Omit<T.TrackState, "queue">> & {
      debug: boolean
      index: number
      name?: string
      getInheritedAudioOptions: () => T.AudioOptions & { trackIdx?: number }
      updateTrackCallback: (trackState: T.TrackState) => void
    }
  ) {
    const {
      debug,
      index,
      name,
      volume,
      updateTrackCallback,
      getInheritedAudioOptions,
      ...rest
    } = args
    this.debug = debug
    this.#index = index
    this.#name = name ?? `Track #${index}`
    this.updateTrackCallback = updateTrackCallback
    this.#getInheritedAudioOptions = () => {
      const { trackIdx, ...rest } = getInheritedAudioOptions()
      return rest
    }
    Object.assign(this.#state, rest)
    if (typeof volume === "number") {
      this.#state.volume = Math.max(0, Math.min(1, volume))
    }
  }

  public getState(): T.TrackState {
    return this.#State
  }

  get #State(): T.TrackState {
    return this.#state
  }

  set #State(value: T.TrackState) {
    this.#state = value
    this.emitState()
  }

  get #Queue(): AudioItem[] {
    return this.#queue
  }

  set #Queue(value: AudioItem[]) {
    this.#queue = value
    const hasItem = this.#queue.length
    const Statepayload: Partial<T.TrackState> = {
      queue: this.#queue.map((item) => item.getState()),
    }
    if (!hasItem) {
      Statepayload.isPlaying = false
      this.#updateStream({
        caption: null,
        audioItemState: null,
        innerAudioState: null,
      })
    } else if (!this.#State.autoPlay) {
      Statepayload.isPlaying = false
      this.#updateStream({
        audioItemState: this.#queue[0]?.getState() ?? null,
        innerAudioState: this.#queue[0]?.getInnerAudioState() ?? null,
      })
    }
    this.#updateState(Statepayload)
  }

  onStateChange(listener: T.Listener<T.TrackState>): () => void {
    this.state_listeners.push(listener)
    return () => {
      this.state_listeners = this.state_listeners.filter((l) => l !== listener)
    }
  }

  public getStream(): T.TrackStream {
    return this.#Stream
  }

  get #Stream(): T.TrackStream {
    return this.#stream
  }

  set #Stream(value: T.TrackStream) {
    this.#stream = value
    this.emitStream()
  }

  onStreamChange(listener: T.Listener<T.TrackStream>): () => void {
    this.stream_listeners.push(listener)
    return () => {
      this.stream_listeners = this.stream_listeners.filter(
        (l) => l !== listener
      )
    }
  }

  #updateStream(value?: Partial<T.TrackStream>) {
    const prev = this.#Stream
    const newState = { ...prev, ...value }
    this.#Stream = newState
  }

  private emitState(): void {
    this.updateTrackCallback(this.#State)
    this.state_listeners.forEach((listener) => listener(this.#State))
  }

  private emitStream(): void {
    this.stream_listeners.forEach((listener) => listener(this.#Stream))
  }

  getCurrentAudio() {
    if (!this.#State.queue.length) return null
    return this.#State.queue[0]
  }

  getNextAudio() {
    if (this.#State.queue.length < 2) return null
    return this.#State.queue[1]
  }

  #updateState(value?: Partial<T.TrackState>) {
    const prev = this.#State
    const newState = { ...prev, ...value }
    this.#State = newState
  }

  public updateState(
    value: Pick<
      Partial<T.TrackState>,
      "autoPlay" | "loop" | "muted" | "volume" | "allowDuplicates"
    >
  ) {
    const { autoPlay, loop, volume, muted, allowDuplicates } = value
    const payload: Partial<T.TrackState> = {}
    if (typeof autoPlay === "boolean") {
      payload.autoPlay = autoPlay
      this.resumeTrack()
    }
    if (typeof loop === "boolean") {
      payload.loop = loop
      this.#Queue.forEach((item) => {
        item.setLoop(loop)
      })
    }
    if (typeof volume === "number") {
      payload.volume = volume
      this.#Queue.forEach((item) => {
        item.setVolume(volume)
      })
    }
    if (typeof muted === "boolean") {
      payload.muted = muted
      this.#Queue.forEach((item) => {
        item.toggleMute(muted)
      })
    }
    if (typeof allowDuplicates === "boolean") {
      payload.allowDuplicates = allowDuplicates
    }
    this.#updateState(payload)
  }

  resumeTrack() {
    if (!this.#Queue.length) return
    const audioItem = this.#Queue[0]
    if (!audioItem || !audioItem?.getState().paused) return
    audioItem.play()
  }

  togglePlay() {
    if (!this.#Queue.length) return
    const audioItem = this.#Queue[0]
    if (!audioItem) return
    if (audioItem?.getState().paused || !audioItem?.getState().started) {
      audioItem.play()
    } else {
      audioItem.pause()
    }
  }

  #createAudio = (
    src: string,
    audioOptions: T.AudioCallbacks & T.AudioOptions
  ) => {
    const filename = U.getFileName(src)
    const {
      volume,
      loop,
      muted,
      locale,
      keyForSubtitles,
      subtitles,
      originalFilename,
      onPlay,
      onUpdate,
      onPause,
      onEnd,
      onError,
    } = audioOptions
    const inhertiedAudioOptions = this.#getInheritedAudioOptions()
    const audio = new Audio(src)
    const uid = Date.now().toString()
    audio.setAttribute("id", uid)
    audio.volume =
      volume ??
      this.defaultAudioOptions.volume ??
      inhertiedAudioOptions.volume ??
      C.DEFAULT_VOLUME
    audio.muted =
      muted ??
      this.defaultAudioOptions.muted ??
      inhertiedAudioOptions.muted ??
      false
    audio.loop =
      loop ??
      this.defaultAudioOptions.loop ??
      inhertiedAudioOptions.loop ??
      false
    const _locale =
      locale ?? this.defaultAudioOptions.locale ?? inhertiedAudioOptions.locale
    const _keyForSubtitles = keyForSubtitles ?? originalFilename ?? filename
    const _subtitles =
      subtitles ??
      Object.prototype.hasOwnProperty.call(
        this.#subtitlesJSON,
        _keyForSubtitles
      )
        ? this.#subtitlesJSON[_keyForSubtitles]!
        : []
    const audioItem = new AudioItem({
      debug: this.debug,
      innerAudio: audio,
      id: uid,
      src: src,
      filename: originalFilename ?? filename,
      onPlay: (firstRun: boolean) => {
        if (firstRun && onPlay) {
          onPlay()
        }
        const payload: Partial<T.TrackStream> = {
          audioItemState: audioItem.getState(),
          innerAudioState: audioItem.getInnerAudioState(),
        }
        if (_subtitles?.length) {
          payload.caption = U.getCurrentCaption(_subtitles, 0, _locale)
        }
        this.#updateState({
          isPlaying: true,
        })
        this.#updateStream(payload)
      },
      onUpdate: () => {
        if (onUpdate) {
          onUpdate()
        }
        const payload: Partial<T.TrackStream> = {
          audioItemState: audioItem.getState(),
          innerAudioState: audioItem.getInnerAudioState(),
        }
        if (_subtitles?.length) {
          payload.caption = U.getCurrentCaption(
            _subtitles,
            audio.currentTime,
            _locale
          )
        }
        this.#updateStream(payload)
      },
      onPause: () => {
        if (onPause) {
          onPause()
        }
        this.#updateState({
          isPlaying: false,
        })
        this.#updateStream({
          audioItemState: audioItem.getState(),
          innerAudioState: audioItem.getInnerAudioState(),
        })
      },
      onEnd: () => {
        if (onEnd) {
          onEnd()
        }
        this.clearAudio(uid, filename)
        this.#updateStream({
          audioItemState: null,
          innerAudioState: null,
          caption: null,
        })
      },
      onError: () => {
        if (onError) {
          onError()
        }
        if (onEnd) {
          onEnd()
        }
        this.#updateStream({
          audioItemState: null,
          innerAudioState: null,
          caption: null,
        })
        this.clearAudio(uid, filename)
      },
    })
    return audioItem
  }

  #pushToQueue(payload: AudioItem) {
    this.#Queue = [...this.#Queue, payload]
  }

  #injectToQueue(splicingIndex: number, payload: AudioItem) {
    const queue = [
      ...this.#Queue.slice(0, splicingIndex),
      payload,
      ...this.#Queue.slice(splicingIndex, this.#Queue.length),
    ]
    this.#Queue = queue
  }

  registerAudio(src: string, options: T.AudioCallbacks & T.AudioOptions) {
    const dup = this.#Queue.find((s) => s.srcEqualTo(src))
    if (!options?.allowDuplicates && !this.#State.allowDuplicates && dup) {
      U.log(
        `Audiotrack Manager prevented playing a duplicate audio (${src})`,
        this.debug
      )
      return
    }
    const audioItem = this.#createAudio(src, options)
    const queueLength = this.#Queue.length
    const { priority } = options
    if (
      typeof priority === "number" &&
      queueLength &&
      priority >= 0 &&
      priority < queueLength
    ) {
      let _priority = priority
      let skipCurrent = false
      if (_priority === 0) {
        _priority = 1
        skipCurrent = true
      }
      // ANCHOR
      this.#injectToQueue(_priority, audioItem)
      if (skipCurrent) {
        this.skipAudio()
      }
    } else {
      this.#pushToQueue(audioItem)
    }
    if (this.#State.autoPlay && queueLength <= 0) {
      audioItem.play()
    }
  }

  skipAudio = (target: number | string = 0, method?: "match" | "include") => {
    if (typeof target === "number") {
      if (this.#Queue.length <= target || target < 0) return
      this.#Queue[target]?.end()
      U.log(
        `force stopping : ${this.#Queue[target]?.getState().src}`,
        this.debug
      )
    } else if (typeof target === "string") {
      if (method === "match") {
        const _item = this.#Queue.find((item) => item.srcEqualTo(target))
        if (_item) {
          _item.end()
        }
      } else if (method === "include") {
        const _item = this.#Queue.find((item) =>
          item.getState().src.includes(target)
        )
        if (_item) {
          _item.end()
        }
      }
    }
  }

  private clearAudio = (uid: string, filename: string) => {
    const soundIdx = this.#Queue.findIndex((s) => s.idEqualTo(uid))
    if (soundIdx) {
      U.log(
        `Cannot clear audio for uid: ${uid} (track & queue index not found)`
      )
      return
    }
    this.#Queue = U.dropFromArray(this.#Queue, soundIdx)
    const nextAudio = this.#Queue.length ? this.#Queue[0] : undefined
    U.log(`cleared ${filename}`)
    if (nextAudio && this.#State.autoPlay) {
      U.log(`next playing ${nextAudio.getState().filename}`)
      nextAudio.play()
    }
  }

  purgeTrack = () => {
    const queueLen = this.#Queue.length
    let queue = this.#State.queue
    if (queueLen) {
      this.#Queue.forEach((item, idx) => {
        if (idx) {
          item.removeAllListeners()
        }
      })
      if (queueLen > 1) {
        this.#Queue = this.#Queue.slice(0, 1)
        queue = queue.slice(0, 1)
      }
      this.#Queue[0]!.end()
    }
    this.#updateState({ queue })
  }

  injectSubtitles = (subtitlesJSON: T.SubtitlesJSON) => {
    this.#subtitlesJSON = subtitlesJSON
  }

  /**
   * Update the inner index value when removing tracks.
   */
  updateIndex(index: number) {
    const prevIndex = this.#index
    this.#index = index
    // if default name
    if (this.#name === `Track #${prevIndex}`) {
      this.#name = `Track #${index}`
    }
  }

  /**
   * Updates the master volume reference.
   *
   * Do not call this method manually.
   */
  applyMasterVolume(override: number) {
    if (override) {
      this.#queue.forEach((item) =>
        item.setVolume(override * this.#State.volume)
      )
    }
  }
}

export default Track