import QtQuick
import Quickshell.Io

Item {
  id: root

  readonly property string launcherPath: decodeURIComponent(
    Qt.resolvedUrl("launch.sh").toString()
  ).replace(/^file:\/\//, "")

  Process {
    id: omarchyBot
    running: true
    command: ["bash", root.launcherPath]
    onExited: (exitCode, exitStatus) => {
      if (exitCode !== 0) launchFailureNotification.running = true
    }
  }

  Process {
    id: launchFailureNotification
    command: [
      "notify-send",
      "-u",
      "critical",
      "Omarchy Bot",
      "Failed to start. See the Omarchy Bot plugin launch log."
    ]
  }
}
