/** Builds an element. `props` are assigned as DOM properties, except `dataset`, which is merged. */
export function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  const { dataset, ...rest } = props;
  Object.assign(element, rest);
  Object.assign(element.dataset, dataset);
  element.append(...children);
  return element;
}
