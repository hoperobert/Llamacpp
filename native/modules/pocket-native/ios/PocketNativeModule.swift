// The few things Pocket LLM needs from iOS that no package offers.
//
// 1. Carrying work on after the app leaves the screen. iOS normally suspends
//    an app within seconds. On iOS 26 an app may ask to finish something the
//    user started (BGContinuedProcessingTask): the system shows its progress
//    and lets it run. Before iOS 26, or if that is refused, there is the older
//    allowance of about half a minute.
// 2. Reading the text out of a PDF.

import BackgroundTasks
import ExpoModulesCore
import PDFKit
import UIKit

public class PocketNativeModule: Module {
  /// The iOS 26 task, held as AnyObject because the type does not exist before iOS 26.
  private var continued: AnyObject?
  private var short: UIBackgroundTaskIdentifier = .invalid

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
      return true
    } catch {
      return false
    }
  }

  private func finish(success: Bool) {
    if #available(iOS 26.0, *) {
      if let task = self.continued as? BGContinuedProcessingTask {
        task.progress.completedUnitCount = task.progress.totalUnitCount
        task.setTaskCompleted(success: success)
      }
    }
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
