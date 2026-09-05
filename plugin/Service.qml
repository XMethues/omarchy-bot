import QtQuick
import Quickshell.Io

Item {
  id: root

  readonly property string supervisorPath: decodeURIComponent(
    Qt.resolvedUrl("supervise.sh").toString()
  ).replace(/^file:\/\//, "")

  Process {
    id: omarchyBot
    running: true
    command: ["bash", root.supervisorPath]
  }
}
