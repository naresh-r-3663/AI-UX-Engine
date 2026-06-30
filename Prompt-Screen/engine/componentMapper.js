const TYPE_TO_COMPONENT = {
  text: "comp.input.text.base",
  textarea: "comp.input.textarea.base",
  dropdown: "comp.input.dropdown.base",
  date: "comp.input.date.base",
  number: "comp.input.number.base",
  button: "comp.primary.button",
  email: "comp.input.email.base",
  phone: "comp.input.phone.base",
  password: "comp.input.password.base",
  checkbox: "comp.input.checkbox.base"
}

function mapField(field){
  const type = field.type || "text"
  const componentName = TYPE_TO_COMPONENT[type] || TYPE_TO_COMPONENT.text

  return {
    componentName,
    label: field.label || null,
    icon: field.icon || null,
    placeholder: field.placeholder || field.label || null,
    enabled: field.enabled !== false,
    visible: field.visible !== false,
    value: field.value ?? null,
    type
  }
}

function mapFields(fields = []){
  return fields.map(mapField)
}

module.exports = {
  mapFields,
  mapField,
  TYPE_TO_COMPONENT
}
