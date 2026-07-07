function buildFrame(layout){
  return {
    type: "FRAME",
    name: layout.name,
    width: layout.width || 1440,
    height: layout.height || 900,
    children: layout.children || [],
    base: layout.base
  }
}

function buildJson(layouts = []){
  return layouts.map(buildFrame)
}

module.exports = buildJson
