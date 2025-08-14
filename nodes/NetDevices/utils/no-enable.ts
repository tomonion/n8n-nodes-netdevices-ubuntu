type Constructor<T = object> = new (...args: any[]) => T;

export function NoEnable<TBase extends Constructor>(Base: TBase) {
	return class NoEnable extends Base {
		constructor(...args: any[]) {
			super(...args);
		}

		async checkEnableMode(): Promise<boolean> {
			return false;
		}

		async enable(): Promise<string> {
			return '';
		}

		async exitEnableMode(): Promise<string> {
			return '';
		}
	};
}
