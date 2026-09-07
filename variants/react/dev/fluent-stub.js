/*
 * Stand-ins for the Fluent components a virtual control's bundle expects to
 * find on the page.
 *
 * ---
 *
 * **Why a stand-in rather than the real thing.**
 *
 * `pcf-scripts` compiles `import { Popover } from '@fluentui/react-components'`
 * down to a reference on a version-encoded global — `FluentUIReactv940.Popover`
 * — because the manifest declares Fluent as a `<platform-library>` and the host
 * supplies it at runtime. On a form that global is the real Fluent. On a plain
 * page it is nothing at all, and there is no file to put in a `<script src>`:
 * **`@fluentui/react-components` ships no UMD build.** Adding a bundler to
 * produce one would make the harness the thing that needs building.
 *
 * So the page defines the global itself, from this file. Eighty lines of
 * stand-in buys a surface that can be clicked, keyboard-driven, screenshotted
 * and switched between host states — none of which `npm start` offers, and none
 * of which `npm run smoke` can show you.
 *
 * ---
 *
 * **What it is not, and this list is the price of admission.** A stub that
 * quietly does *more* than the thing it stands in for certifies a control that
 * does not work. These all do less, which is the safe direction — but you have
 * to know which:
 *
 *   - **Nothing is portalled.** The real `PopoverSurface` mounts near the end
 *     of `document.body`; here it is a descendant of the control's own root.
 *     A stylesheet rule scoped through the control's root therefore works on
 *     this page and matches nothing on a form. Lead popover rules with their
 *     own class, and confirm in `npm start`.
 *   - **No focus trap and no Escape.** Fluent's `trapFocus` brings both; this
 *     brings neither, so tab order inside a surface is the document's own.
 *   - **`FluentProvider` publishes no design tokens unless the theme carries
 *     them**, which is deliberate: it exercises the literal fallbacks in the
 *     stylesheet — the branch a canvas app and PCFHub's demo harness actually
 *     get. `webDarkTheme` below carries a small set to exercise the other.
 *
 * ---
 *
 * **Adding a component.** Stub the ones your control imports and no more. A
 * plain wrapper is usually enough; the non-obvious case is a *compound*
 * component, where Fluent's parts talk to each other through React context.
 * `Popover` below is the worked example: each part carries a
 * `__harnessRole` marker and the parent reads its own children for them, which
 * is enough because the parent is the only thing that renders them.
 *
 * The scaffolded control imports little or none of this. It is here so that the
 * first Fluent import does not also cost you a browser rig.
 */

(function (global) {
    'use strict';

    var React = global.__harnessReact;

    if (!React) {
        throw new Error('fluent-stub.js needs window.__harnessReact set to the React UMD build.');
    }

    /**
     * Fluent's web *dark* values for the tokens a control is most likely to
     * name, as CSS custom properties.
     *
     * Not a theme — a theme is several hundred tokens and reproducing one here
     * would be maintaining a copy of Fluent. The point is to prove the `var()`
     * side of every declaration resolves against *something*, and that the
     * light literal beside it is reachable when it does not. Add the tokens
     * your stylesheet actually names; anything missing falls back, which is
     * exactly what a partial host theme does.
     */
    var DARK_TOKENS = {
        colorNeutralBackground1: '#292929',
        colorNeutralBackground1Hover: '#383838',
        colorNeutralBackground3: '#141414',
        colorNeutralForeground1: '#ffffff',
        colorNeutralForeground2: '#d6d6d6',
        colorNeutralForeground4: '#999999',
        colorNeutralForegroundDisabled: '#5c5c5c',
        colorNeutralForegroundOnBrand: '#ffffff',
        colorNeutralStroke1: '#666666',
        colorNeutralStroke2: '#404040',
        colorNeutralStrokeDisabled: '#424242',
        colorTransparentStroke: 'transparent',
        colorTransparentBackground: 'transparent',
        colorCompoundBrandStroke: '#479ef5',
        colorCompoundBrandStrokePressed: '#2886de',
        colorPaletteRedForeground1: '#e37d80',
        colorBrandBackground: '#115ea3',
        colorBrandBackgroundHover: '#0f6cbd',
        colorBrandBackground2: '#082338',
        colorBrandStroke1: '#479ef5',
        colorBrandStroke2: '#0f548c',
        colorSubtleBackgroundHover: '#383838',
        colorSubtleBackgroundPressed: '#2e2e2e',
        colorStrokeFocus1: '#000000',
        colorStrokeFocus2: '#ffffff',
    };

    /** Themes the control can pass straight through to the provider. */
    var webLightTheme = { __harnessTheme: 'light' };
    var webDarkTheme = Object.assign({ __harnessTheme: 'dark' }, DARK_TOKENS);

    function FluentProvider(props) {
        var style = {};

        // A theme carrying tokens publishes them the way the real provider
        // does. One carrying none publishes none, so the stylesheet falls back
        // — which is a host, not a failure.
        Object.keys(props.theme || {}).forEach(function (key) {
            if (key.indexOf('color') === 0) {
                style['--' + key] = props.theme[key];
            }
        });

        return React.createElement(
            'div',
            { className: props.className, dir: props.dir, style: style },
            props.children,
        );
    }

    function PopoverTrigger(props) {
        return props.children;
    }

    PopoverTrigger.__harnessRole = 'trigger';

    function PopoverSurface(props) {
        return React.createElement(
            'div',
            {
                className: props.className,
                role: 'dialog',
                'aria-label': props['aria-label'],
                // Inline rather than portalled — see the header — but still
                // drawn as a layer, so what is on screen is not misleading
                // about how the control will look.
                style: {
                    position: 'absolute',
                    zIndex: 1,
                    // A floating layer sizes to its content. Absolute
                    // positioning alone sizes to the containing block, which
                    // squeezes a wide surface into the form column's width and
                    // makes the page lie about the layout.
                    width: 'max-content',
                    maxWidth: 'calc(100vw - 2rem)',
                    marginTop: '4px',
                    background: 'var(--colorNeutralBackground1, #ffffff)',
                    border: '1px solid var(--colorTransparentStroke, transparent)',
                    borderRadius: '4px',
                    boxShadow: '0 8px 16px rgba(0,0,0,.14), 0 0 2px rgba(0,0,0,.12)',
                },
            },
            props.children,
        );
    }

    PopoverSurface.__harnessRole = 'surface';

    function Popover(props) {
        var trigger = null;
        var surface = null;

        React.Children.forEach(props.children, function (child) {
            if (!child || !child.type) {
                return;
            }

            if (child.type.__harnessRole === 'trigger') {
                trigger = child;
            } else if (child.type.__harnessRole === 'surface') {
                surface = child;
            }
        });

        var toggle = function () {
            if (props.onOpenChange) {
                props.onOpenChange({}, { open: !props.open });
            }
        };

        /*
         * The real `PopoverTrigger` **clones its child** to add the click
         * handler, `aria-haspopup` and `aria-expanded`. Reproduced because it
         * is load-bearing in both directions: a control whose trigger is a
         * styled `<div>` gets those attributes for free, and a control that
         * puts a real `<button>` inside that `<div>` ends up with two tab stops
         * for one control. Neither is visible without this.
         */
        var child = trigger && trigger.props.children;
        var cloned = child
            ? React.cloneElement(child, {
                onClick: toggle,
                'aria-haspopup': 'dialog',
                'aria-expanded': props.open ? 'true' : 'false',
            })
            : null;

        return React.createElement(
            'div',
            { style: { position: 'relative' } },
            cloned,
            props.open ? surface : null,
        );
    }

    global.__harnessFluent = {
        FluentProvider: FluentProvider,
        Popover: Popover,
        PopoverTrigger: PopoverTrigger,
        PopoverSurface: PopoverSurface,
        webLightTheme: webLightTheme,
        webDarkTheme: webDarkTheme,
    };
})(window);
