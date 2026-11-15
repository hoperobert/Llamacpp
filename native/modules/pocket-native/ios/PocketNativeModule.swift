// The few things Pocket LLM needs from iOS that no package offers.
//
// 1. Carrying work on after the app leaves the screen. iOS normally suspends
//    an app within seconds. On iOS 26 an app may ask to finish something the
//    user started (BGContinuedProcessingTask): the system shows its progress
//    and lets it run. Before iOS 26, or if that is refused, there is the older
//    allowance of about half a minute.
// 2. Reading the text out of a PDF.
// 3. Reading the text in a photo (a page, a sign, a screenshot), so that a
//    model that cannot look at pictures can still be asked about one.
// 4. For emergencies: the torch, the screen's brightness, and a loud alarm
//    that sounds even with the ringer switched off.
// 5. Handing files in one folder to the app's own web view over the phone's
//    internal address (127.0.0.1), which is how Python is run with no
//    internet: a web view will not load a program straight from a file.

import AVFoundation
import BackgroundTasks
import ExpoModulesCore
import Network
import PDFKit
import UIKit
import Vision

public class PocketNativeModule: Module {
  /// The iOS 26 task, held as AnyObject because the type does not exist before iOS 26.
  private var continued: AnyObject?
  /** The name of the work asked for, kept so that it can be withdrawn if iOS has not started it. */
  private var asked: String?
  private var short: UIBackgroundTaskIdentifier = .invalid
  private var alarm: AVAudioEngine?
  private var listener: NWListener?
  private let filesQueue = DispatchQueue(label: "pocket.files")

  /// Where the alarm's tone has got to. A class, so the sound's own thread can keep it.
  private final class Tone {
    var phase = 0.0
    var time = 0.0
  }

  /// Whether a question has been answered yet. A class, so that whichever thread answers can say so.
  private final class Once {
    var done = false
  }

  private static let fileTypes: [String: String] = [
    "html": "text/html; charset=utf-8", "js": "text/javascript", "mjs": "text/javascript",
    "wasm": "application/wasm", "json": "application/json", "zip": "application/zip",
    "css": "text/css", "txt": "text/plain; charset=utf-8", "py": "text/plain; charset=utf-8",
    "whl": "application/zip", "svg": "image/svg+xml", "png": "image/png",
  ]

  public func definition() -> ModuleDefinition {
    Name("PocketNative")

    // Sent when iOS says the time is up: whatever is running has to stop now.
    Events("onExpire")

    /// "continued" where work can carry on until it is done, otherwise "short".
    Function("backgroundKind") { () -> String in
      if #available(iOS 26.0, *) {
        return "continued"
      }
      return "short"
    }

    /// Seconds iOS will still let the app run in the background. Huge while on screen.
    AsyncFunction("timeRemaining") { () -> Double in
      let remaining = UIApplication.shared.backgroundTimeRemaining
      return remaining > 100_000 ? 100_000 : remaining
    }.runOnQueue(.main)

    /// Asks for time to finish something. Returns "continued", "short" or "none".
    AsyncFunction("begin") { (title: String, subtitle: String) -> String in
      self.finish(success: true)
      if #available(iOS 26.0, *) {
        if self.beginContinued(title: title, subtitle: subtitle) {
          return "continued"
        }
      }
      self.short = UIApplication.shared.beginBackgroundTask(withName: "Pocket LLM reply") { [weak self] in
        self?.sendEvent("onExpire", [:])
        self?.endShort()
      }
      return self.short == .invalid ? "none" : "short"
    }.runOnQueue(.main)

    /// How far along the work is, from 0 to 1, for the system's display of it.
    AsyncFunction("progress") { (fraction: Double) in
      if #available(iOS 26.0, *) {
        if let task = self.continued as? BGContinuedProcessingTask {
          task.progress.completedUnitCount = Int64(max(0, min(1, fraction)) * 100)
        }
      }
    }.runOnQueue(.main)

    AsyncFunction("end") { (success: Bool) in
      self.finish(success: success)
    }.runOnQueue(.main)

    /// The torch: 0 is off, up to 1 for full. False where there is none.
    AsyncFunction("torch") { (level: Double) -> Bool in
      guard let device = AVCaptureDevice.default(for: .video), device.hasTorch else {
        return false
      }
      do {
        try device.lockForConfiguration()
        if level <= 0 {
          device.torchMode = .off
        } else {
          try device.setTorchModeOn(level: min(Float(level), AVCaptureDevice.maxAvailableTorchLevel))
        }
        device.unlockForConfiguration()
        return true
      } catch {
        return false
      }
    }

    /// Sets how bright the screen is, from 0 to 1, and returns how bright it was. Below 0 only asks.
    AsyncFunction("brightness") { (level: Double) -> Double in
      let was = Double(UIScreen.main.brightness)
      if level >= 0 {
        UIScreen.main.brightness = CGFloat(min(1, level))
      }
      return was
    }.runOnQueue(.main)

    /// A loud rising tone, over and over, to be found by. It sounds with the ringer switched off.
    AsyncFunction("alarm") { (on: Bool) -> Bool in
      self.stopAlarm()
      if !on {
        return true
      }
      do {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playback, mode: .default, options: [])
        try session.setActive(true)
        let engine = AVAudioEngine()
        let rate = engine.outputNode.inputFormat(forBus: 0).sampleRate > 0 ? engine.outputNode.inputFormat(forBus: 0).sampleRate : 44100.0
        let tone = Tone()
        let source = AVAudioSourceNode { _, _, frameCount, audioBufferList -> OSStatus in
          let buffers = UnsafeMutableAudioBufferListPointer(audioBufferList)
          for frame in 0..<Int(frameCount) {
            // Three sweeps a second through the pitches a small speaker is loudest at.
            let sweep = tone.time.truncatingRemainder(dividingBy: 0.33) / 0.33
            tone.phase += 2.0 * Double.pi * (2400.0 + 1200.0 * sweep) / rate
            if tone.phase > 2.0 * Double.pi {
              tone.phase -= 2.0 * Double.pi
            }
            tone.time += 1.0 / rate
            let sample = Float(sin(tone.phase))
            for buffer in buffers {
              let samples = UnsafeMutableBufferPointer<Float>(buffer)
              if frame < samples.count {
                samples[frame] = sample
              }
            }
          }
          return noErr
        }
        engine.attach(source)
        engine.connect(source, to: engine.mainMixerNode, format: AVAudioFormat(standardFormatWithSampleRate: rate, channels: 1))
        try engine.start()
        self.alarm = engine
        return true
      } catch {
        self.stopAlarm()
        return false
      }
    }.runOnQueue(.main)

    /// Starts handing out the files in a folder at http://127.0.0.1:<port>/ and returns the port. 0 if it could not.
    AsyncFunction("serve") { (directory: String, promise: Promise) in
      self.listener?.cancel()
      self.listener = nil
      guard let root = URL(string: directory), root.isFileURL else {
        promise.resolve(0)
        return
      }
      // This phone only: nothing outside it can reach the address.
      let parameters = NWParameters.tcp
      parameters.allowLocalEndpointReuse = true
      parameters.requiredLocalEndpoint = NWEndpoint.hostPort(host: NWEndpoint.Host("127.0.0.1"), port: NWEndpoint.Port.any)
      guard let listener = try? NWListener(using: parameters) else {
        promise.resolve(0)
        return
      }
      let answered = Once()
      listener.stateUpdateHandler = { [weak listener] state in
        switch state {
        case .ready:
          if !answered.done {
            answered.done = true
            promise.resolve(Int(listener?.port?.rawValue ?? 0))
          }
        case .failed, .cancelled:
          if !answered.done {
            answered.done = true
            promise.resolve(0)
          }
        default:
          break
        }
      }
      listener.newConnectionHandler = { [weak self] connection in
        self?.hand(connection, from: root)
      }
      self.listener = listener
      listener.start(queue: self.filesQueue)
    }

    AsyncFunction("stopServing") { () in
      self.listener?.cancel()
      self.listener = nil
    }

    /// The text of a PDF, page by page. Empty for one that is only pictures.
    AsyncFunction("pdfText") { (uri: String) -> String in
      guard let url = URL(string: uri) ?? URL(fileURLWithPath: uri) as URL?,
            let document = PDFDocument(url: url) else {
        return ""
      }
      var pages: [String] = []
      for index in 0..<document.pageCount {
        if let text = document.page(at: index)?.string, !text.isEmpty {
          pages.append(text)
        }
      }
      return pages.joined(separator: "\n\n")
    }

    /// The text found in a picture, line by line. Empty if there is none.
    AsyncFunction("imageText") { (uri: String, promise: Promise) in
      guard let url = URL(string: uri) else {
        promise.resolve("")
        return
      }
      var answered = false
      let answer = { (text: String) in
        if !answered {
          answered = true
          promise.resolve(text)
        }
      }
      let request = VNRecognizeTextRequest { request, _ in
        let found = request.results as? [VNRecognizedTextObservation] ?? []
        answer(found.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n"))
      }
      request.recognitionLevel = .accurate
      request.usesLanguageCorrection = true
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          try VNImageRequestHandler(url: url, options: [:]).perform([request])
        } catch {
          answer("")
        }
      }
    }
  }

  @available(iOS 26.0, *)
  private func beginContinued(title: String, subtitle: String) -> Bool {
    let bundle = Bundle.main.bundleIdentifier ?? "app"
    // One name per piece of work: a single handler for the whole pattern is not matched.
    let identifier = "\(bundle).reply.\(UUID().uuidString)"
    let registered = BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: DispatchQueue.main) { [weak self] task in
      guard let self = self, let task = task as? BGContinuedProcessingTask else {
        task.setTaskCompleted(success: false)
        return
      }
      self.continued = task
      task.progress.totalUnitCount = 100
      task.progress.completedUnitCount = 0
      task.expirationHandler = { [weak self] in
        self?.sendEvent("onExpire", [:])
      }
    }
    if !registered {
      return false
    }
    let request = BGContinuedProcessingTaskRequest(identifier: identifier, title: title, subtitle: subtitle)
    do {
      try BGTaskScheduler.shared.submit(request)
      self.asked = identifier
      return true
    } catch {
      return false
    }
  }

  private func stopAlarm() {
    if let engine = self.alarm {
      engine.stop()
      self.alarm = nil
      try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
  }

  /// Answers one request for a file in the folder being served. Nothing outside the folder is given.
  private func hand(_ connection: NWConnection, from root: URL) {
    connection.start(queue: self.filesQueue)
    connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { data, _, _, _ in
      var status = "404 Not Found"
      var body = Data()
      var type = "text/plain"
      if let data = data, let request = String(data: data, encoding: .utf8),
         let line = request.components(separatedBy: "\r\n").first {
        let parts = line.components(separatedBy: " ")
        if parts.count >= 2, parts[0] == "GET" {
          var path = parts[1].components(separatedBy: "?")[0]
          path = path.removingPercentEncoding ?? path
          if path == "/" {
            path = "/index.html"
          }
          if !path.contains("..") {
            let file = root.appendingPathComponent(String(path.dropFirst()))
            if let found = try? Data(contentsOf: file, options: .mappedIfSafe) {
              status = "200 OK"
              body = found
              type = PocketNativeModule.fileTypes[file.pathExtension.lowercased()] ?? "application/octet-stream"
            }
          }
        }
      }
      let head = "HTTP/1.1 \(status)\r\nContent-Type: \(type)\r\nContent-Length: \(body.count)\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
      var reply = Data(head.utf8)
      reply.append(body)
      connection.send(content: reply, completion: .contentProcessed { _ in
        connection.cancel()
      })
    }
  }

  private func finish(success: Bool) {
    if #available(iOS 26.0, *) {
      if let task = self.continued as? BGContinuedProcessingTask {
        task.progress.completedUnitCount = task.progress.totalUnitCount
        task.setTaskCompleted(success: success)
      } else if let asked = self.asked {
        // Asked for but never started by iOS: withdraw it, or it could start later with nothing to do.
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: asked)
      }
    }
    self.asked = nil
    self.continued = nil
    self.endShort()
  }

  private func endShort() {
    if self.short != .invalid {
      UIApplication.shared.endBackgroundTask(self.short)
      self.short = .invalid
    }
  }
}
