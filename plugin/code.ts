figma.showUI(__html__, { width: 400, height: 600 })

figma.ui.onmessage = async (msg) => {

  if (msg.type !== "render") return

  let json

  try {
    json = JSON.parse(msg.json)
  } catch (err) {
    figma.notify("Invalid JSON")
    return
  }

  const node = await buildNode(json)

  if (node) {
    figma.currentPage.appendChild(node)
    figma.viewport.scrollAndZoomIntoView([node])
  }

}


function getNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback
}

async function buildNode(data) {

  if (!data || typeof data !== "object") return null

  let node = null

  switch (data.type) {

    case "FRAME":
      node = figma.createFrame()
      node.resize(
        getNumber(data.width, 1440),
        getNumber(data.height, 900)
      )
      node.layoutMode =
        data.layoutMode !== undefined && data.layoutMode !== null
          ? data.layoutMode
          : "NONE"
      break

    case "RECTANGLE":
      node = figma.createRectangle()
      node.resize(
        getNumber(data.width, 100),
        getNumber(data.height, 100)
      )
      break

    case "TEXT":
      node = figma.createText()
      await figma.loadFontAsync({ family: "Inter", style: "Regular" })
      node.characters = data.characters || ""
      break

    case "INSTANCE":
      node = await createInstance(data.componentKey)
      break
  }

  if (!node) return null

  if (data.name) node.name = data.name
  if (Number.isFinite(data.x)) node.x = data.x
  if (Number.isFinite(data.y)) node.y = data.y

  if (Array.isArray(data.children)) {

    for (const child of data.children) {

      const childNode = await buildNode(child)

      if (childNode) node.appendChild(childNode)

    }
  }

  return node
}


async function createInstance(componentKey) {

  if (!componentKey) return null

  if (componentKey.startsWith("COMPONENT_KEY")) {
    return null
  }

  try {

    const component = await figma.importComponentByKeyAsync(componentKey)

    return component.createInstance()

  } catch (err) {

    console.warn("Component import failed:", componentKey)

    return null
  }
}
