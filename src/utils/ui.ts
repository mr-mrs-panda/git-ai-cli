import * as p from "@clack/prompts";

export type ClackSpinner = ReturnType<typeof p.spinner>;

/**
 * A wrapper around the Clack spinner that tracks its active state
 * to prevent double-stop calls and handle internal vs external lifecycle.
 */
export class Spinner {
    private spinner: ClackSpinner;
    private isInternal: boolean;
    private _isActive: boolean = false;

    constructor(externalSpinner?: ClackSpinner | Spinner) {
        if (externalSpinner instanceof Spinner) {
            // If passed another Spinner instance, use its underlying spinner
            this.spinner = externalSpinner.getUnderlyingSpinner();
            this.isInternal = false;
        } else {
            this.spinner = externalSpinner ?? p.spinner();
            this.isInternal = !externalSpinner;
        }
    }

    /**
     * Get the underlying clack spinner (for compatibility with functions expecting raw spinner)
     */
    getUnderlyingSpinner(): ClackSpinner {
        return this.spinner;
    }

    start(msg?: string) {
        this.spinner.start(msg);
        this._isActive = true;
    }

    stop(msg?: string) {
        if (this._isActive) {
            this.spinner.stop(msg);
            this._isActive = false;
        }
    }

    message(msg: string) {
        this.spinner.message(msg);
    }

    get isActive(): boolean {
        return this._isActive;
    }

    /**
     * Safely stops the spinner for cleanup (e.g. in finally blocks).
     * Only stops if the spinner is:
     * 1. Currently active
     * 2. AND (was created internally OR force is true)
     */
    stopOnFinally(force: boolean = false) {
        if (this._isActive) {
            if (this.isInternal || force) {
                this.spinner.stop();
                this._isActive = false;
            }
        }
    }
}

