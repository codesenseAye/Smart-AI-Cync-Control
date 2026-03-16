declare module "selfsigned" {
  interface Attribute {
    name: string;
    value: string;
  }

  interface Options {
    days?: number;
    keySize?: number;
  }

  interface GenerateResult {
    private: string;
    public: string;
    cert: string;
    fingerprint: string;
  }

  function generate(attrs: Attribute[], opts?: Options): Promise<GenerateResult>;
  export = { generate };
}
