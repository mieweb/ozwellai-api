// Validate the packaged ozwell popup with the system WebKit extension runtime.
// Requires macOS 15.4+ and an Xcode Swift toolchain with WKWebExtension APIs.
// Run from the repository root:
//   xcrun swift browser-extension/scripts/validate-safari-popup.swift /path/to/ozwell.app
// An explicit .appex path is also accepted.
//
// This uses the SIGNED BUNDLE initializer, not the resource-directory initializer
// (which skips resource signature validation). It loads the actual action popup
// and checks its HTML, CSS, mascot, imported JavaScript, and runtime errors.
// It does not install or register an extension, activate an app, read Safari's
// profile, supply credentials, or validate the hosted chat server/sign-in flow.
// Safari's own toolbar popup still needs a separate manual check after updates.

import AppKit
import Foundation
import WebKit

func fail(_ message: String, code: Int32 = 1) -> Never {
    FileHandle.standardError.write(Data("FAIL: \(message)\n".utf8))
    exit(code)
}

func appExtensionURL(for input: String) throws -> URL {
    let url = URL(fileURLWithPath: input).standardizedFileURL
    if url.pathExtension == "appex" { return url }
    guard url.pathExtension == "app" else {
        fail("Pass an ozwell .app or .appex bundle path.")
    }
    let plugIns = url.appendingPathComponent("Contents/PlugIns", isDirectory: true)
    let candidates = try FileManager.default.contentsOfDirectory(at: plugIns, includingPropertiesForKeys: nil)
        .filter { candidate in
            candidate.pathExtension == "appex" && FileManager.default.fileExists(
                atPath: candidate.appendingPathComponent("Contents/Resources/manifest.json").path
            )
        }
    guard candidates.count == 1, let candidate = candidates.first else {
        fail("Expected exactly one web extension in \(plugIns.path); found \(candidates.count). Pass its .appex path explicitly.")
    }
    return candidate
}

@available(macOS 15.4, *)
@MainActor
func validatePopup(at bundleURL: URL) async {
    guard let bundle = Bundle(url: bundleURL) else {
        fail("Unable to read app extension bundle at \(bundleURL.path).")
    }
    do {
        let webExtension = try await WKWebExtension(appExtensionBundle: bundle)
        let context = WKWebExtensionContext(for: webExtension)
        // A standalone host grants manifest permissions explicitly; Safari
        // normally handles this when the user enables the extension.
        for permission in webExtension.requestedPermissions {
            context.setPermissionStatus(.grantedExplicitly, for: permission)
        }
        let configuration = WKWebExtensionController.Configuration.nonPersistent()
        configuration.defaultWebsiteDataStore = .nonPersistent()
        let controller = WKWebExtensionController(configuration: configuration)
        try controller.load(context)
        guard let action = context.action(for: nil), let webView = action.popupWebView else {
            fail("The extension has no action popup.")
        }
        webView.frame = NSRect(x: 0, y: 0, width: 420, height: 600)
        let inspectPopup = """
        JSON.stringify({
          title: document.title,
          heading: document.querySelector('h1')?.textContent,
          powerButton: Boolean(document.querySelector('#power-button')),
          powerEnabled: document.querySelector('#power-button')?.disabled === false,
          cssLoaded: getComputedStyle(document.querySelector('.popup-header') || document.body).display === 'flex',
          mascotLoaded: document.querySelector('.mascot')?.naturalWidth > 0,
          moduleLoaded: Boolean(document.querySelector('#open-ozwell')?.href),
          error: document.querySelector('#error')?.textContent,
          url: location.href
        })
        """
        func resourcesLoaded(_ result: [String: Any]) -> Bool {
            result["heading"] as? String == "ozwell"
                && result["powerButton"] as? Bool == true
                && result["powerEnabled"] as? Bool == true
                && result["cssLoaded"] as? Bool == true
                && result["mascotLoaded"] as? Bool == true
                && result["moduleLoaded"] as? Bool == true
                && result["error"] as? String == ""
        }
        var result: [String: Any] = [:]
        let deadline = Date().addingTimeInterval(12)
        repeat {
            try await Task.sleep(for: .milliseconds(250))
            if let json = try? await webView.evaluateJavaScript(inspectPopup) as? String,
               let bytes = json.data(using: .utf8),
               let parsed = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any] {
                result = parsed
                if resourcesLoaded(result) { break }
            }
        } while Date() < deadline

        print("Bundle: \(bundleURL.path)")
        print("Version: \(bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") ?? "?") / build \(bundle.object(forInfoDictionaryKey: "CFBundleVersion") ?? "?")")
        let json = try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
        print(String(decoding: json, as: UTF8.self))
        print("Extension errors: \(webExtension.errors.map { ($0 as NSError).description })")
        print("Context errors: \(context.errors.map { ($0 as NSError).description })")
        let passed = resourcesLoaded(result) && webExtension.errors.isEmpty && context.errors.isEmpty
        try controller.unload(context)
        if !passed { fail("The signed popup resources did not all load cleanly.") }
        print("PASS: signed bundle popup HTML, CSS, mascot, and JavaScript loaded without runtime errors.")
        exit(0)
    } catch {
        fail(String(describing: error))
    }
}

let arguments = Array(CommandLine.arguments.dropFirst())
if arguments == ["--help"] || arguments == ["-h"] {
    print("Usage: xcrun swift validate-safari-popup.swift /path/to/ozwell.app-or-appex")
    print("Requires macOS 15.4+; validates packaged popup resources, not hosted chat or Safari's enabled instance.")
    exit(0)
}
guard arguments.count == 1 else { fail("Usage: xcrun swift validate-safari-popup.swift /path/to/ozwell.app-or-appex") }
guard #available(macOS 15.4, *) else { fail("macOS 15.4+ is required for WKWebExtension runtime validation.") }
let bundleURL: URL
do { bundleURL = try appExtensionURL(for: arguments[0]) }
catch { fail(String(describing: error)) }

// Bound the entire process as well as the polling loop, including WebKit calls
// that could otherwise leave a failed web content process waiting indefinitely.
DispatchQueue.global().asyncAfter(deadline: .now() + 20) {
    fail("Timed out after 20 seconds while loading the signed popup.", code: 2)
}
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
Task { @MainActor in await validatePopup(at: bundleURL) }
app.run()
