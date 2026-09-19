export class Text {
  constructor(public text: string, _x = 0, _y = 0) {}
}

export function visibleWidth(value: string): number {
  return value.length;
}

export function wrapTextWithAnsi(value: string, _width: number): string[] {
  return [value];
}

export const Key = {
  escape: "escape",
  up: "up",
  down: "down",
  left: "left",
  right: "right",
  enter: "enter",
  tab: "tab",
};

export function matchesKey(_input: string, _key: unknown): boolean {
  return false;
}

export class Editor {
  onSubmit: ((value: string) => void) | undefined;
  setText(_value: string): void {}
  handleInput(_value: string): void {}
  render(_width: number): string[] {
    return [];
  }
}
