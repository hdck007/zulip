"use strict";

const {strict: assert} = require("assert");
const path = require("path");

require("css.escape");
require("handlebars/runtime");
const {JSDOM} = require("jsdom");
const _ = require("lodash");

const handlebars = require("./handlebars");
const stub_i18n = require("./i18n");
const namespace = require("./namespace");
const test = require("./test");
const blueslip = require("./zblueslip");
const zjquery = require("./zjquery");
const zpage_params = require("./zpage_params");

process.env.NODE_ENV = "test";

const dom = new JSDOM("", {url: "http://zulip.zulipdev.com/"});
global.DOMParser = dom.window.DOMParser;
global.navigator = {
    userAgent: "node.js",
};

require("@babel/register")({
    extensions: [".es6", ".es", ".jsx", ".js", ".mjs", ".ts"],
    only: [
        new RegExp("^" + _.escapeRegExp(path.resolve(__dirname, "../../shared/src") + path.sep)),
        new RegExp("^" + _.escapeRegExp(path.resolve(__dirname, "../../src") + path.sep)),
    ],
    plugins: [
        "babel-plugin-rewire-ts",
        ["@babel/plugin-transform-modules-commonjs", {lazy: () => true}],
    ],
});

// Create a helper function to avoid sneaky delays in tests.
function immediate(f) {
    return () => f();
}

// Find the files we need to run.
const files = process.argv.slice(2);
assert.notEqual(files.length, 0, "No tests found");

// Set up our namespace helpers.
const window = new Proxy(global, {
    set(obj, prop, value) {
        namespace.set_global(prop, value);
        return true;
    },
});

const ls_container = new Map();
const localStorage = {
    getItem(key) {
        return ls_container.get(key);
    },
    setItem(key, val) {
        ls_container.set(key, val);
    },
    /* istanbul ignore next */
    removeItem(key) {
        ls_container.delete(key);
    },
    clear() {
        ls_container.clear();
    },
};

// Set up Handlebars
handlebars.hook_require();

const noop = function () {};

/* istanbul ignore next */
function short_tb(tb) {
    const lines = tb.split("\n");

    const i = lines.findIndex((line) => line.includes("run_one_module"));

    if (i === -1) {
        return tb;
    }

    return lines.splice(0, i + 1).join("\n") + "\n(...)\n";
}

require("../../src/templates"); // register Zulip extensions

async function run_one_module(file) {
    zjquery.clear_initialize_function();
    zjquery.clear_all_elements();
    console.info("running test " + path.basename(file, ".test.js"));
    test.set_current_file_name(file);
    test.suite.length = 0;
    require(file);
    for (const f of test.suite) {
        await f();
    }
    namespace.complain_about_unused_mocks();
}

test.set_verbose(files.length === 1);

(async () => {
    for (const file of files) {
        namespace.start();
        namespace.set_global("window", window);
        namespace.set_global("location", dom.window.location);
        window.location.href = "http://zulip.zulipdev.com/#";
        namespace.set_global("setTimeout", noop);
        namespace.set_global("setInterval", noop);
        namespace.set_global("localStorage", localStorage);
        ls_container.clear();
        _.throttle = immediate;
        _.debounce = immediate;
        zpage_params.reset();

        namespace.mock_esm("../../src/blueslip", blueslip);
        require("../../src/blueslip");
        namespace.mock_esm("../../src/i18n", stub_i18n);
        require("../../src/i18n");
        namespace.mock_esm("../../src/page_params", zpage_params);
        require("../../src/page_params");
        namespace.mock_esm("../../src/user_settings", zpage_params);
        require("../../src/user_settings");
        namespace.mock_esm("../../src/realm_user_settings_defaults", zpage_params);
        require("../../src/realm_user_settings_defaults");

        await run_one_module(file);

        if (blueslip.reset) {
            blueslip.reset();
        }

        namespace.finish();
    }
})().catch((error) => /* istanbul ignore next */ {
    if (process.env.USING_INSTRUMENTED_CODE) {
        console.info(`
    TEST FAILED! Before using the --coverage option please make sure that your
    tests work under normal conditions.

        `);
    } else if (error.stack) {
        console.info(short_tb(error.stack));
    } else {
        console.info(error);
    }
    process.exit(1);
});
