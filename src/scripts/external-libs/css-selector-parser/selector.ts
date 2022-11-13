/**
 * Source: https://github.com/mdevils/css-selector-parser
 */
export type Selector = Selectors | RuleSet;
export type SelectorEntity = Selectors | RuleSet | Rule;

export interface RuleSet {
    type: 'ruleSet';
    rule: Rule;
}

export interface Selectors {
    type: 'selectors';
    selectors: RuleSet[];
}

export type AttrValueType = 'string' | 'substitute';

export type RuleAttr = {name: string} & ({} | {
    operator: string;
    valueType: AttrValueType;
    value: string;
});

export type RulePseudo = {
    name: string;
} & (
    {valueType: 'selector', value: Selector} |
    {valueType: 'string' | 'substitute' | 'numeric', value: string}
)

export interface Rule {
    type: 'rule';
    tagName?: string;
    id?: string;
    classNames?: string[];
    attrs: RuleAttr[];
    pseudos: RulePseudo[];
    nestingOperator: string | null;
    rule?: Rule;
}
