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
  }
}
