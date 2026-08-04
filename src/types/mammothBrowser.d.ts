declare module 'mammoth/mammoth.browser' {
  interface MammothMessage {
    type: 'warning' | 'error';
    message: string;
  }

  interface MammothResult {
    value: string;
    messages: MammothMessage[];
  }

  interface Mammoth {
    extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<MammothResult>;
  }

  const mammoth: Mammoth;
  export default mammoth;
}
