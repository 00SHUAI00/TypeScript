/// <reference path="checker.ts" />
/// <reference path="factory.ts" />
/// <reference path="utilities.ts" />

/* @internal */
namespace ts {
    export type VisitResult<T extends Node> = T | T[];

    /**
     * Describes an edge of a Node, used when traversing a syntax tree.
     */
    interface NodeEdge {
        /** The property name for the edge. */
        name: string;

        /** Indicates that the result is optional. */
        optional?: boolean;

        /** A callback used to test whether a node is valid. */
        test?: (node: Node) => node is Node;

        /** A callback used to lift a NodeArrayNode into a valid node. */
        lift?: (nodes: NodeArray<Node>) => Node;

        /** A callback used to parenthesize a node to preserve the intended order of operations. */
        parenthesize?: (value: Node, parentNode: Node) => Node;
    };

    /**
     * Describes the shape of a Node.
     */
    type NodeTraversalPath = NodeEdge[];

    /**
     * This map contains information about the shape of each Node in "types.ts" pertaining to how
     * each node should be traversed during a transformation.
     *
     * Each edge corresponds to a property in a Node subtype that should be traversed when visiting
     * each child. The properties are assigned in the order in which traversal should occur.
     *
     * NOTE: This needs to be kept up to date with changes to nodes in "types.ts". Currently, this
     *       map is not comprehensive. Only node edges relevant to tree transformation are
     *       currently defined. We may extend this to be more comprehensive, and eventually
     *       supplant the existing `forEachChild` implementation if performance is not
     *       significantly impacted.
     */
    const nodeEdgeTraversalMap: Map<NodeTraversalPath> = {
        [SyntaxKind.TypeAssertionExpression]: [
            { name: "type", test: isTypeNode },
            { name: "expression", test: isUnaryExpression }
        ],
        [SyntaxKind.AwaitExpression]: [
            { name: "expression", test: isUnaryExpression, parenthesize: parenthesizePrefixOperand }
        ],
        [SyntaxKind.AsExpression]: [
            { name: "expression", test: isExpression },
            { name: "type", test: isTypeNode }
        ],
        [SyntaxKind.NonNullExpression]: [
            { name: "expression", test: isLeftHandSideExpression }
        ],
        [SyntaxKind.TryStatement]: [
            { name: "tryBlock", test: isBlock },
            { name: "catchClause", test: isCatchClause, optional: true },
            { name: "finallyBlock", test: isBlock, optional: true }
        ],
        [SyntaxKind.EnumDeclaration]: [
            { name: "decorators", test: isDecorator },
            { name: "modifiers", test: isModifier },
            { name: "name", test: isIdentifier },
            { name: "members", test: isEnumMember }
        ],
        [SyntaxKind.ModuleDeclaration]: [
            { name: "decorators", test: isDecorator },
            { name: "modifiers", test: isModifier },
            { name: "name", test: isModuleName },
            { name: "body", test: isModuleBody }
        ],
        [SyntaxKind.ModuleBlock]: [
            { name: "statements", test: isStatement }
        ],
        [SyntaxKind.ImportEqualsDeclaration]: [
            { name: "decorators", test: isDecorator },
            { name: "modifiers", test: isModifier },
            { name: "name", test: isIdentifier },
            { name: "moduleReference", test: isModuleReference }
        ],
        [SyntaxKind.ImportDeclaration]: [
            { name: "decorators", test: isDecorator },
            { name: "modifiers", test: isModifier },
            { name: "importClause", test: isImportClause, optional: true },
            { name: "moduleSpecifier", test: isExpression }
        ],
        [SyntaxKind.ImportClause]: [
            { name: "name", test: isIdentifier, optional: true },
            { name: "namedBindings", test: isNamedImportBindings, optional: true }
        ],
        [SyntaxKind.NamespaceImport]: [
            { name: "name", test: isIdentifier }
        ],
        [SyntaxKind.NamedImports]: [
            { name: "elements", test: isImportSpecifier }
        ],
        [SyntaxKind.ImportSpecifier]: [
            { name: "propertyName", test: isIdentifier, optional: true },
            { name: "name", test: isIdentifier }
        ],
        [SyntaxKind.ExportAssignment]: [
            { name: "decorators", test: isDecorator },
            { name: "modifiers", test: isModifier },
            { name: "expression", test: isExpression }
        ],
        [SyntaxKind.ExportDeclaration]: [
            { name: "decorators", test: isDecorator },
            { name: "modifiers", test: isModifier },
            { name: "exportClause", test: isNamedExports, optional: true },
            { name: "moduleSpecifier", test: isExpression, optional: true }
        ],
        [SyntaxKind.NamedExports]: [
            { name: "elements", test: isExportSpecifier }
        ],
        [SyntaxKind.ExportSpecifier]: [
            { name: "propertyName", test: isIdentifier, optional: true },
            { name: "name", test: isIdentifier }
        ],
        [SyntaxKind.ExternalModuleReference]: [
            { name: "expression", test: isExpression, optional: true }
        ],
        [SyntaxKind.JsxElement]: [
            { name: "openingElement", test: isJsxOpeningElement },
            { name: "children", test: isJsxChild },
            { name: "closingElement", test: isJsxClosingElement }
        ],
        [SyntaxKind.JsxSelfClosingElement]: [
            { name: "tagName", test: isEntityName },
            { name: "attributes", test: isJsxAttributeLike }
        ],
        [SyntaxKind.JsxOpeningElement]: [
            { name: "tagName", test: isEntityName },
            { name: "attributes", test: isJsxAttributeLike }
        ],
        [SyntaxKind.JsxClosingElement]: [
            { name: "tagName", test: isEntityName }
        ],
        [SyntaxKind.JsxAttribute]: [
            { name: "name", test: isIdentifier },
            { name: "initializer", test: isStringLiteralOrJsxExpression, optional: true }
        ],
        [SyntaxKind.JsxSpreadAttribute]: [
            { name: "expression", test: isExpression }
        ],
        [SyntaxKind.JsxExpression]: [
            { name: "expression", test: isExpression, optional: true }
        ],
        [SyntaxKind.CatchClause]: [
            { name: "variableDeclaration", test: isVariableDeclaration },
            { name: "block", test: isBlock }
        ],
        [SyntaxKind.EnumMember]: [
            { name: "name", test: isPropertyName },
            { name: "initializer", test: isExpression, optional: true, parenthesize: parenthesizeExpressionForList }
        ]
    };

    function reduceNode<T>(node: Node, f: (memo: T, node: Node) => T, initial: T) {
        return node ? f(initial, node) : initial;
    }

    /**
     * Similar to `reduceLeft`, performs a reduction against each child of a node.
     * NOTE: Unlike `forEachChild`, this does *not* visit every node. Only nodes added to the
     *       `nodeEdgeTraversalMap` above will be visited.
     *
     * @param node The node containing the children to reduce.
     * @param f The callback function
     * @param initial The initial value to supply to the reduction.
     */
    export function reduceEachChild<T>(node: Node, f: (memo: T, node: Node) => T, initial: T): T {
        if (node === undefined) {
            return initial;
        }

        const kind = node.kind;

        // No need to visit nodes with no children.
        if ((kind > SyntaxKind.FirstToken && kind <= SyntaxKind.LastToken)) {
            return initial;
        }

        let result = initial;
        switch (kind) {
            // Leaf nodes
            case SyntaxKind.ThisType:
            case SyntaxKind.StringLiteralType:
            case SyntaxKind.SemicolonClassElement:
            case SyntaxKind.EmptyStatement:
            case SyntaxKind.OmittedExpression:
            case SyntaxKind.DebuggerStatement:
                // No need to visit nodes with no children.
                break;

            // Names
            case SyntaxKind.QualifiedName:
                result = reduceNode((<QualifiedName>node).left, f, result);
                result = reduceNode((<QualifiedName>node).right, f, result);
                break;

            case SyntaxKind.ComputedPropertyName:
                result = reduceNode((<ComputedPropertyName>node).expression, f, result);
                break;

            // Signature elements
            case SyntaxKind.Parameter:
                result = reduceLeft((<ParameterDeclaration>node).decorators, f, result);
                result = reduceLeft((<ParameterDeclaration>node).modifiers, f, result);
                result = reduceNode((<ParameterDeclaration>node).name, f, result);
                result = reduceNode((<ParameterDeclaration>node).type, f, result);
                result = reduceNode((<ParameterDeclaration>node).initializer, f, result);
                break;

            case SyntaxKind.Decorator:
                result = reduceNode((<Decorator>node).expression, f, result);
                break;

            // Type member
            case SyntaxKind.PropertyDeclaration:
                result = reduceLeft((<PropertyDeclaration>node).decorators, f, result);
                result = reduceLeft((<PropertyDeclaration>node).modifiers, f, result);
                result = reduceNode((<PropertyDeclaration>node).name, f, result);
                result = reduceNode((<PropertyDeclaration>node).type, f, result);
                result = reduceNode((<PropertyDeclaration>node).initializer, f, result);
                break;

            case SyntaxKind.MethodDeclaration:
                result = reduceLeft((<MethodDeclaration>node).decorators, f, result);
                result = reduceLeft((<MethodDeclaration>node).modifiers, f, result);
                result = reduceNode((<MethodDeclaration>node).name, f, result);
                result = reduceLeft((<MethodDeclaration>node).typeParameters, f, result);
                result = reduceLeft((<MethodDeclaration>node).parameters, f, result);
                result = reduceNode((<MethodDeclaration>node).type, f, result);
                result = reduceNode((<MethodDeclaration>node).body, f, result);
                break;

            case SyntaxKind.Constructor:
                result = reduceLeft((<ConstructorDeclaration>node).modifiers, f, result);
                result = reduceLeft((<ConstructorDeclaration>node).parameters, f, result);
                result = reduceNode((<ConstructorDeclaration>node).body, f, result);
                break;

            case SyntaxKind.GetAccessor:
                result = reduceLeft((<GetAccessorDeclaration>node).decorators, f, result);
                result = reduceLeft((<GetAccessorDeclaration>node).modifiers, f, result);
                result = reduceNode((<GetAccessorDeclaration>node).name, f, result);
                result = reduceLeft((<GetAccessorDeclaration>node).parameters, f, result);
                result = reduceNode((<GetAccessorDeclaration>node).type, f, result);
                result = reduceNode((<GetAccessorDeclaration>node).body, f, result);
                break;

            case SyntaxKind.SetAccessor:
                result = reduceLeft((<GetAccessorDeclaration>node).decorators, f, result);
                result = reduceLeft((<GetAccessorDeclaration>node).modifiers, f, result);
                result = reduceNode((<GetAccessorDeclaration>node).name, f, result);
                result = reduceLeft((<GetAccessorDeclaration>node).parameters, f, result);
                result = reduceNode((<GetAccessorDeclaration>node).body, f, result);
                break;

            // Binding patterns
            case SyntaxKind.ObjectBindingPattern:
            case SyntaxKind.ArrayBindingPattern:
                result = reduceLeft((<BindingPattern>node).elements, f, result);
                break;

            case SyntaxKind.BindingElement:
                result = reduceNode((<BindingElement>node).propertyName, f, result);
                result = reduceNode((<BindingElement>node).name, f, result);
                result = reduceNode((<BindingElement>node).initializer, f, result);
                break;

            // Expression
            case SyntaxKind.ArrayLiteralExpression:
                result = reduceLeft((<ArrayLiteralExpression>node).elements, f, result);
                break;

            case SyntaxKind.ObjectLiteralExpression:
                result = reduceLeft((<ObjectLiteralExpression>node).properties, f, result);
                break;

            case SyntaxKind.PropertyAccessExpression:
                result = reduceNode((<PropertyAccessExpression>node).expression, f, result);
                result = reduceNode((<PropertyAccessExpression>node).name, f, result);
                break;

            case SyntaxKind.CallExpression:
                result = reduceNode((<CallExpression>node).expression, f, result);
                result = reduceLeft((<CallExpression>node).typeArguments, f, result);
                result = reduceLeft((<CallExpression>node).arguments, f, result);
                break;

            case SyntaxKind.NewExpression:
                result = reduceNode((<NewExpression>node).expression, f, result);
                result = reduceLeft((<NewExpression>node).typeArguments, f, result);
                result = reduceLeft((<NewExpression>node).arguments, f, result);
                break;

            case SyntaxKind.TaggedTemplateExpression:
                result = reduceNode((<TaggedTemplateExpression>node).tag, f, result);
                result = reduceNode((<TaggedTemplateExpression>node).template, f, result);
                break;

            case SyntaxKind.FunctionExpression:
                result = reduceLeft((<FunctionExpression>node).modifiers, f, result);
                result = reduceNode((<FunctionExpression>node).name, f, result);
                result = reduceLeft((<FunctionExpression>node).typeParameters, f, result);
                result = reduceLeft((<FunctionExpression>node).parameters, f, result);
                result = reduceNode((<FunctionExpression>node).type, f, result);
                result = reduceNode((<FunctionExpression>node).body, f, result);
                break;

            case SyntaxKind.ArrowFunction:
                result = reduceLeft((<ArrowFunction>node).modifiers, f, result);
                result = reduceLeft((<ArrowFunction>node).typeParameters, f, result);
                result = reduceLeft((<ArrowFunction>node).parameters, f, result);
                result = reduceNode((<ArrowFunction>node).type, f, result);
                result = reduceNode((<ArrowFunction>node).body, f, result);
                break;

            case SyntaxKind.ParenthesizedExpression:
            case SyntaxKind.DeleteExpression:
            case SyntaxKind.TypeOfExpression:
            case SyntaxKind.VoidExpression:
            case SyntaxKind.AwaitExpression:
            case SyntaxKind.YieldExpression:
            case SyntaxKind.SpreadElementExpression:
                result = reduceNode((<ParenthesizedExpression | DeleteExpression | TypeOfExpression | VoidExpression | AwaitExpression | YieldExpression | SpreadElementExpression>node).expression, f, result);
                break;

            case SyntaxKind.PrefixUnaryExpression:
            case SyntaxKind.PostfixUnaryExpression:
                result = reduceNode((<PrefixUnaryExpression | PostfixUnaryExpression>node).operand, f, result);
                break;

            case SyntaxKind.BinaryExpression:
                result = reduceNode((<BinaryExpression>node).left, f, result);
                result = reduceNode((<BinaryExpression>node).right, f, result);
                break;

            case SyntaxKind.ConditionalExpression:
                result = reduceNode((<ConditionalExpression>node).condition, f, result);
                result = reduceNode((<ConditionalExpression>node).whenTrue, f, result);
                result = reduceNode((<ConditionalExpression>node).whenFalse, f, result);
                break;

            case SyntaxKind.TemplateExpression:
                result = reduceNode((<TemplateExpression>node).head, f, result);
                result = reduceLeft((<TemplateExpression>node).templateSpans, f, result);
                break;

            case SyntaxKind.ClassExpression:
                result = reduceLeft((<ClassExpression>node).modifiers, f, result);
                result = reduceNode((<ClassExpression>node).name, f, result);
                result = reduceLeft((<ClassExpression>node).typeParameters, f, result);
                result = reduceLeft((<ClassExpression>node).heritageClauses, f, result);
                result = reduceLeft((<ClassExpression>node).members, f, result);
                break;

            case SyntaxKind.ExpressionWithTypeArguments:
                result = reduceNode((<ExpressionWithTypeArguments>node).expression, f, result);
                result = reduceLeft((<ExpressionWithTypeArguments>node).typeArguments, f, result);
                break;

            // Misc
            case SyntaxKind.TemplateSpan:
                result = reduceNode((<TemplateSpan>node).expression, f, result);
                result = reduceNode((<TemplateSpan>node).literal, f, result);
                break;

            // Element

            case SyntaxKind.Block:
                result = reduceLeft((<Block>node).statements, f, result);
                break;

            case SyntaxKind.VariableStatement:
                result = reduceLeft((<VariableStatement>node).modifiers, f, result);
                result = reduceNode((<VariableStatement>node).declarationList, f, result);
                break;

            case SyntaxKind.ExpressionStatement:
                result = reduceNode((<ExpressionStatement>node).expression, f, result);
                break;

            case SyntaxKind.IfStatement:
                result = reduceNode((<IfStatement>node).expression, f, result);
                result = reduceNode((<IfStatement>node).thenStatement, f, result);
                result = reduceNode((<IfStatement>node).elseStatement, f, result);
                break;

            case SyntaxKind.DoStatement:
                result = reduceNode((<DoStatement>node).statement, f, result);
                result = reduceNode((<DoStatement>node).expression, f, result);
                break;

            case SyntaxKind.WhileStatement:
            case SyntaxKind.WithStatement:
                result = reduceNode((<WhileStatement | WithStatement>node).expression, f, result);
                result = reduceNode((<WhileStatement | WithStatement>node).statement, f, result);
                break;

            case SyntaxKind.ForStatement:
                result = reduceNode((<ForStatement>node).initializer, f, result);
                result = reduceNode((<ForStatement>node).condition, f, result);
                result = reduceNode((<ForStatement>node).incrementor, f, result);
                result = reduceNode((<ForStatement>node).statement, f, result);
                break;

            case SyntaxKind.ForInStatement:
            case SyntaxKind.ForOfStatement:
                result = reduceNode((<ForInStatement | ForOfStatement>node).initializer, f, result);
                result = reduceNode((<ForInStatement | ForOfStatement>node).expression, f, result);
                result = reduceNode((<ForInStatement | ForOfStatement>node).statement, f, result);
                break;

            case SyntaxKind.ReturnStatement:
            case SyntaxKind.ThrowStatement:
                result = reduceNode((<ReturnStatement>node).expression, f, result);
                break;

            case SyntaxKind.SwitchStatement:
                result = reduceNode((<SwitchStatement>node).expression, f, result);
                result = reduceNode((<SwitchStatement>node).caseBlock, f, result);
                break;

            case SyntaxKind.LabeledStatement:
                result = reduceNode((<LabeledStatement>node).label, f, result);
                result = reduceNode((<LabeledStatement>node).statement, f, result);
                break;

            case SyntaxKind.TryStatement:
                result = reduceNode((<TryStatement>node).tryBlock, f, result);
                result = reduceNode((<TryStatement>node).catchClause, f, result);
                result = reduceNode((<TryStatement>node).finallyBlock, f, result);
                break;

            case SyntaxKind.VariableDeclaration:
                result = reduceNode((<VariableDeclaration>node).name, f, result);
                result = reduceNode((<VariableDeclaration>node).type, f, result);
                result = reduceNode((<VariableDeclaration>node).initializer, f, result);
                break;

            case SyntaxKind.VariableDeclarationList:
                result = reduceLeft((<VariableDeclarationList>node).declarations, f, result);
                break;

            case SyntaxKind.FunctionDeclaration:
                result = reduceLeft((<FunctionDeclaration>node).decorators, f, result);
                result = reduceLeft((<FunctionDeclaration>node).modifiers, f, result);
                result = reduceNode((<FunctionDeclaration>node).name, f, result);
                result = reduceLeft((<FunctionDeclaration>node).typeParameters, f, result);
                result = reduceLeft((<FunctionDeclaration>node).parameters, f, result);
                result = reduceNode((<FunctionDeclaration>node).type, f, result);
                result = reduceNode((<FunctionDeclaration>node).body, f, result);
                break;

            case SyntaxKind.ClassDeclaration:
                result = reduceLeft((<ClassDeclaration>node).decorators, f, result);
                result = reduceLeft((<ClassDeclaration>node).modifiers, f, result);
                result = reduceNode((<ClassDeclaration>node).name, f, result);
                result = reduceLeft((<ClassDeclaration>node).typeParameters, f, result);
                result = reduceLeft((<ClassDeclaration>node).heritageClauses, f, result);
                result = reduceLeft((<ClassDeclaration>node).members, f, result);
                break;

            case SyntaxKind.CaseBlock:
                result = reduceLeft((<CaseBlock>node).clauses, f, result);
                break;

            // Clauses
            case SyntaxKind.CaseClause:
                result = reduceNode((<CaseClause>node).expression, f, result);
                // fall-through
            case SyntaxKind.DefaultClause:
                result = reduceLeft((<CaseClause | DefaultClause>node).statements, f, result);
                break;

            case SyntaxKind.HeritageClause:
                result = reduceLeft((<HeritageClause>node).types, f, result);
                break;

            case SyntaxKind.CatchClause:
                result = reduceNode((<CatchClause>node).variableDeclaration, f, result);
                result = reduceNode((<CatchClause>node).block, f, result);
                break;

            // Property assignments
            case SyntaxKind.PropertyAssignment:
                result = reduceNode((<PropertyAssignment>node).name, f, result);
                result = reduceNode((<PropertyAssignment>node).initializer, f, result);
                break;

            case SyntaxKind.ShorthandPropertyAssignment:
                result = reduceNode((<ShorthandPropertyAssignment>node).name, f, result);
                result = reduceNode((<ShorthandPropertyAssignment>node).objectAssignmentInitializer, f, result);
                break;

            // Top-level nodes
            case SyntaxKind.SourceFile:
                result = reduceLeft((<SourceFile>node).statements, f, result);
                break;

            default:
                const edgeTraversalPath = nodeEdgeTraversalMap[kind];
                if (edgeTraversalPath) {
                    for (const edge of edgeTraversalPath) {
                        const value = (<Map<any>>node)[edge.name];
                        if (value !== undefined) {
                            result = isArray(value)
                                ? reduceLeft(<NodeArray<Node>>value, f, result)
                                : f(result, <Node>value);
                        }
                    }
                }
                break;
        }

        return result;

    }

    /**
     * Visits a Node using the supplied visitor, possibly returning a new Node in its place.
     *
     * @param node The Node to visit.
     * @param visitor The callback used to visit the Node.
     * @param test A callback to execute to verify the Node is valid.
     * @param optional An optional value indicating whether the Node is itself optional.
     * @param lift An optional callback to execute to lift a NodeArrayNode into a valid Node.
     */
    export function visitNode<T extends Node>(node: T, visitor: (node: Node) => VisitResult<Node>, test: (node: Node) => boolean, optional?: boolean, lift?: (node: NodeArray<Node>) => T): T;
    export function visitNode<T extends Node>(node: T, visitor: (node: Node) => VisitResult<Node>, test: (node: Node) => boolean, optional: boolean, lift: (node: NodeArray<Node>) => T, parenthesize: (node: Node, parentNode: Node) => Node, parentNode: Node): T;
    export function visitNode(node: Node, visitor: (node: Node) => VisitResult<Node>, test: (node: Node) => boolean, optional?: boolean, lift?: (node: Node[]) => Node, parenthesize?: (node: Node, parentNode: Node) => Node, parentNode?: Node): Node {
        if (node === undefined) {
            return undefined;
        }

        const visited = visitor(node);
        if (visited === node) {
            return node;
        }

        let visitedNode: Node;
        if (visited === undefined) {
            if (!optional) {
                Debug.failNotOptional();
            }

            return undefined;
        }
        else if (isArray(visited)) {
            visitedNode = (lift || extractSingleNode)(visited);
        }
        else {
            visitedNode = visited;
        }

        if (parenthesize !== undefined) {
            visitedNode = parenthesize(visitedNode, parentNode);
        }

        Debug.assertNode(visitedNode, test);
        aggregateTransformFlags(visitedNode);
        return visitedNode;
    }

    /**
     * Visits a NodeArray using the supplied visitor, possibly returning a new NodeArray in its place.
     *
     * @param nodes The NodeArray to visit.
     * @param visitor The callback used to visit a Node.
     * @param test A node test to execute for each node.
     * @param start An optional value indicating the starting offset at which to start visiting.
     * @param count An optional value indicating the maximum number of nodes to visit.
     */
    export function visitNodes<T extends Node>(nodes: NodeArray<T>, visitor: (node: Node) => VisitResult<Node>, test: (node: Node) => boolean, start?: number, count?: number): NodeArray<T>;
    export function visitNodes<T extends Node>(nodes: NodeArray<T>, visitor: (node: Node) => VisitResult<Node>, test: (node: Node) => boolean, start: number, count: number, parenthesize: (node: Node, parentNode: Node) => Node, parentNode: Node): NodeArray<T>;
    export function visitNodes(nodes: NodeArray<Node>, visitor: (node: Node) => VisitResult<Node>, test: (node: Node) => boolean, start?: number, count?: number, parenthesize?: (node: Node, parentNode: Node) => Node, parentNode?: Node): NodeArray<Node> {
        if (nodes === undefined) {
            return undefined;
        }

        let updated: NodeArray<Node>;

        // Ensure start and count have valid values
        const length = nodes.length;
        if (start === undefined || start < 0) {
            start = 0;
        }

        if (count === undefined || count > length - start) {
            count = length - start;
        }

        if (start > 0 || count < length) {
            // If we are not visiting all of the original nodes, we must always create a new array.
            // Since this is a fragment of a node array, we do not copy over the previous location
            // and will only copy over `hasTrailingComma` if we are including the last element.
            updated = createNodeArray<Node>([], /*location*/ undefined,
                /*hasTrailingComma*/ nodes.hasTrailingComma && start + count === length);
        }

        // Visit each original node.
        for (let i = 0; i < count; i++) {
            const node = nodes[i + start];
            const visited = node !== undefined ? visitor(node) : undefined;
            if (updated !== undefined || visited === undefined || visited !== node) {
                if (updated === undefined) {
                    // Ensure we have a copy of `nodes`, up to the current index.
                    updated = createNodeArray(nodes.slice(0, i), /*location*/ nodes, nodes.hasTrailingComma);
                }

                addNode(updated, visited, /*addOnNewLine*/ undefined, test, parenthesize, parentNode, /*isVisiting*/ visited !== node);
            }
        }

        return updated || nodes;
    }

    /**
     * Visits each child of a Node using the supplied visitor, possibly returning a new Node of the same kind in its place.
     *
     * @param node The Node whose children will be visited.
     * @param visitor The callback used to visit each child.
     * @param context A lexical environment context for the visitor.
     */
    export function visitEachChild<T extends Node>(node: T, visitor: (node: Node) => VisitResult<Node>, context: LexicalEnvironment): T;
    export function visitEachChild(node: Node, visitor: (node: Node) => VisitResult<Node>, context: LexicalEnvironment): Node {
        if (node === undefined) {
            return undefined;
        }

        const kind = node.kind;
        // No need to visit nodes with no children.
        if ((kind > SyntaxKind.FirstToken && kind <= SyntaxKind.LastToken)) {
            return node;
        }

        // Special cases for frequent visitors to improve performance.
        switch (kind) {
            case SyntaxKind.ThisType:
            case SyntaxKind.StringLiteralType:
            case SyntaxKind.SemicolonClassElement:
            case SyntaxKind.EmptyStatement:
            case SyntaxKind.OmittedExpression:
            case SyntaxKind.DebuggerStatement:
                // No need to visit nodes with no children.
                return node;

            // Names
            case SyntaxKind.QualifiedName:
                return updateQualifiedName(<QualifiedName>node,
                    visitNode((<QualifiedName>node).left, visitor, isEntityName),
                    visitNode((<QualifiedName>node).right, visitor, isIdentifier));

            case SyntaxKind.ComputedPropertyName:
                return updateComputedPropertyName(<ComputedPropertyName>node,
                    visitNode((<ComputedPropertyName>node).expression, visitor, isExpression));

            // Signature elements
            case SyntaxKind.Parameter:
                return updateParameterDeclaration((<ParameterDeclaration>node),
                    visitNodes((<ParameterDeclaration>node).decorators, visitor, isDecorator),
                    visitNodes((<ParameterDeclaration>node).modifiers, visitor, isModifier),
                    visitNode((<ParameterDeclaration>node).name, visitor, isBindingName),
                    visitNode((<ParameterDeclaration>node).type, visitor, isTypeNode, /*optional*/ true),
                    visitNode((<ParameterDeclaration>node).initializer, visitor, isExpression, /*optional*/ true));

            case SyntaxKind.Decorator:
                return updateDecorator(<Decorator>node,
                    visitNode((<Decorator>node).expression, visitor, isLeftHandSideExpression));

            // Type member
            case SyntaxKind.PropertyDeclaration:
                return updateProperty(<PropertyDeclaration>node,
                    visitNodes((<PropertyDeclaration>node).decorators, visitor, isDecorator),
                    visitNodes((<PropertyDeclaration>node).modifiers, visitor, isModifier),
                    visitNode((<PropertyDeclaration>node).name, visitor, isPropertyName),
                    visitNode((<PropertyDeclaration>node).type, visitor, isTypeNode, /*optional*/ true),
                    visitNode((<PropertyDeclaration>node).initializer, visitor, isExpression, /*optional*/ true));

            case SyntaxKind.MethodDeclaration:
                return updateMethod(<MethodDeclaration>node,
                    visitNodes((<MethodDeclaration>node).decorators, visitor, isDecorator),
                    visitNodes((<MethodDeclaration>node).modifiers, visitor, isModifier),
                    visitNode((<MethodDeclaration>node).name, visitor, isPropertyName),
                    visitNodes((<MethodDeclaration>node).typeParameters, visitor, isTypeParameter),
                    startLexicalEnvironmentAndVisitParameters((<MethodDeclaration>node).parameters, visitor, context),
                    visitNode((<MethodDeclaration>node).type, visitor, isTypeNode, /*optional*/ true),
                    endLexicalEnvironmentAndUpdateBody(
                        visitNode((<MethodDeclaration>node).body, visitor, isFunctionBody, /*optional*/ true),
                        context));

            case SyntaxKind.Constructor:
                return updateConstructor(<ConstructorDeclaration>node,
                    visitNodes((<ConstructorDeclaration>node).decorators, visitor, isDecorator),
                    visitNodes((<ConstructorDeclaration>node).modifiers, visitor, isModifier),
                    startLexicalEnvironmentAndVisitParameters((<ConstructorDeclaration>node).parameters, visitor, context),
                    endLexicalEnvironmentAndUpdateBody(
                        visitNode((<ConstructorDeclaration>node).body, visitor, isFunctionBody, /*optional*/ true),
                        context));

            case SyntaxKind.GetAccessor:
                return updateGetAccessor(<GetAccessorDeclaration>node,
                    visitNodes((<GetAccessorDeclaration>node).decorators, visitor, isDecorator),
                    visitNodes((<GetAccessorDeclaration>node).modifiers, visitor, isModifier),
                    visitNode((<GetAccessorDeclaration>node).name, visitor, isPropertyName),
                    startLexicalEnvironmentAndVisitParameters((<GetAccessorDeclaration>node).parameters, visitor, context),
                    visitNode((<GetAccessorDeclaration>node).type, visitor, isTypeNode, /*optional*/ true),
                    endLexicalEnvironmentAndUpdateBody(
                        visitNode((<GetAccessorDeclaration>node).body, visitor, isFunctionBody, /*optional*/ true),
                        context));

            case SyntaxKind.SetAccessor:
                return updateSetAccessor(<SetAccessorDeclaration>node,
                    visitNodes((<SetAccessorDeclaration>node).decorators, visitor, isDecorator),
                    visitNodes((<SetAccessorDeclaration>node).modifiers, visitor, isModifier),
                    visitNode((<SetAccessorDeclaration>node).name, visitor, isPropertyName),
                    startLexicalEnvironmentAndVisitParameters((<SetAccessorDeclaration>node).parameters, visitor, context),
                    endLexicalEnvironmentAndUpdateBody(
                        visitNode((<SetAccessorDeclaration>node).body, visitor, isFunctionBody, /*optional*/ true),
                        context));

            // Binding patterns
            case SyntaxKind.ObjectBindingPattern:
                return updateObjectBindingPattern(<ObjectBindingPattern>node,
                    visitNodes((<ObjectBindingPattern>node).elements, visitor, isBindingElement));

            case SyntaxKind.ArrayBindingPattern:
                return updateArrayBindingPattern(<ArrayBindingPattern>node,
                    visitNodes((<ArrayBindingPattern>node).elements, visitor, isBindingElement));

            case SyntaxKind.BindingElement:
                return updateBindingElement(<BindingElement>node,
                    visitNode((<BindingElement>node).propertyName, visitor, isPropertyName, /*optional*/ true),
                    visitNode((<BindingElement>node).name, visitor, isBindingName),
                    visitNode((<BindingElement>node).initializer, visitor, isExpression, /*optional*/ true));

            // Expression
            case SyntaxKind.ArrayLiteralExpression:
                return updateArrayLiteral(<ArrayLiteralExpression>node,
                    visitNodes((<ArrayLiteralExpression>node).elements, visitor, isExpression));

            case SyntaxKind.ObjectLiteralExpression:
                return updateObjectLiteral(<ObjectLiteralExpression>node,
                    visitNodes((<ObjectLiteralExpression>node).properties, visitor, isExpression));

            case SyntaxKind.PropertyAccessExpression:
                return updatePropertyAccess((<PropertyAccessExpression>node),
                    visitNode((<PropertyAccessExpression>node).expression, visitor, isExpression),
                    visitNode((<PropertyAccessExpression>node).name, visitor, isIdentifier));

            case SyntaxKind.ElementAccessExpression:
                return updateElementAccess(<ElementAccessExpression>node,
                    visitNode((<ElementAccessExpression>node).expression, visitor, isExpression),
                    visitNode((<ElementAccessExpression>node).argumentExpression, visitor, isExpression));

            case SyntaxKind.CallExpression:
                return updateCall((<CallExpression>node),
                    visitNode((<CallExpression>node).expression, visitor, isExpression),
                    visitNodes((<CallExpression>node).typeArguments, visitor, isTypeNode),
                    visitNodes((<CallExpression>node).arguments, visitor, isExpression));

            case SyntaxKind.NewExpression:
                return updateNew((<NewExpression>node),
                    visitNode((<NewExpression>node).expression, visitor, isExpression),
                    visitNodes((<NewExpression>node).typeArguments, visitor, isTypeNode),
                    visitNodes((<NewExpression>node).arguments, visitor, isExpression));

            case SyntaxKind.TaggedTemplateExpression:
                return updateTaggedTemplate(<TaggedTemplateExpression>node,
                    visitNode((<TaggedTemplateExpression>node).tag, visitor, isExpression),
                    visitNode((<TaggedTemplateExpression>node).template, visitor, isTemplate));

            case SyntaxKind.ParenthesizedExpression:
                return updateParen((<ParenthesizedExpression>node),
                    visitNode((<ParenthesizedExpression>node).expression, visitor, isExpression));

            case SyntaxKind.FunctionExpression:
                return updateFunctionExpression(<FunctionExpression>node,
                    visitNode((<FunctionExpression>node).name, visitor, isPropertyName),
                    visitNodes((<FunctionExpression>node).typeParameters, visitor, isTypeParameter),
                    startLexicalEnvironmentAndVisitParameters((<FunctionExpression>node).parameters, visitor, context),
                    visitNode((<FunctionExpression>node).type, visitor, isTypeNode, /*optional*/ true),
                    endLexicalEnvironmentAndUpdateBody(
                        visitNode((<FunctionExpression>node).body, visitor, isFunctionBody, /*optional*/ true),
                        context));

            case SyntaxKind.ArrowFunction:
                return updateArrowFunction(<ArrowFunction>node,
                    visitNodes((<ArrowFunction>node).modifiers, visitor, isModifier),
                    visitNodes((<ArrowFunction>node).typeParameters, visitor, isTypeParameter),
                    startLexicalEnvironmentAndVisitParameters((<ArrowFunction>node).parameters, visitor, context),
                    visitNode((<ArrowFunction>node).type, visitor, isTypeNode, /*optional*/ true),
                    endLexicalEnvironmentAndUpdateBody(
                        visitNode((<ArrowFunction>node).body, visitor, isConciseBody, /*optional*/ true),
                        context));

            case SyntaxKind.DeleteExpression:
                return updateDelete(<DeleteExpression>node,
                    visitNode((<DeleteExpression>node).expression, visitor, isUnaryExpression));

            case SyntaxKind.TypeOfExpression:
                return updateTypeOf(<TypeOfExpression>node,
                    visitNode((<TypeOfExpression>node).expression, visitor, isUnaryExpression));

            case SyntaxKind.VoidExpression:
                return updateVoid(<VoidExpression>node,
                    visitNode((<VoidExpression>node).expression, visitor, isUnaryExpression));

            case SyntaxKind.BinaryExpression:
                return updateBinary((<BinaryExpression>node),
                    visitNode((<BinaryExpression>node).left, visitor, isExpression),
                    visitNode((<BinaryExpression>node).right, visitor, isExpression));

            case SyntaxKind.PrefixUnaryExpression:
                return updatePrefix(<PrefixUnaryExpression>node,
                    visitNode((<PrefixUnaryExpression>node).operand, visitor, isExpression));

            case SyntaxKind.PostfixUnaryExpression:
                return updatePostfix(<PostfixUnaryExpression>node,
                    visitNode((<PostfixUnaryExpression>node).operand, visitor, isExpression));

            case SyntaxKind.ConditionalExpression:
                return updateConditional(<ConditionalExpression>node,
                    visitNode((<ConditionalExpression>node).condition, visitor, isExpression),
                    visitNode((<ConditionalExpression>node).whenTrue, visitor, isExpression),
                    visitNode((<ConditionalExpression>node).whenFalse, visitor, isExpression));

            case SyntaxKind.TemplateExpression:
                return updateTemplateExpression(<TemplateExpression>node,
                    visitNode((<TemplateExpression>node).head, visitor, isTemplateLiteralFragment),
                    visitNodes((<TemplateExpression>node).templateSpans, visitor, isTemplateSpan));

            case SyntaxKind.YieldExpression:
                return updateYield(<YieldExpression>node,
                    visitNode((<YieldExpression>node).expression, visitor, isExpression));

            case SyntaxKind.SpreadElementExpression:
                return updateSpread(<SpreadElementExpression>node,
                    visitNode((<SpreadElementExpression>node).expression, visitor, isExpression));

            case SyntaxKind.ClassExpression:
                return updateClassExpression(<ClassExpression>node,
                    visitNodes((<ClassExpression>node).modifiers, visitor, isModifier),
                    visitNode((<ClassExpression>node).name, visitor, isIdentifier, /*optional*/ true),
                    visitNodes((<ClassExpression>node).typeParameters, visitor, isTypeParameter),
                    visitNodes((<ClassExpression>node).heritageClauses, visitor, isHeritageClause),
                    visitNodes((<ClassExpression>node).members, visitor, isClassElement));

            case SyntaxKind.ExpressionWithTypeArguments:
                return updateExpressionWithTypeArguments(<ExpressionWithTypeArguments>node,
                    visitNodes((<ExpressionWithTypeArguments>node).typeArguments, visitor, isTypeNode),
                    visitNode((<ExpressionWithTypeArguments>node).expression, visitor, isExpression));

            // Misc
            case SyntaxKind.TemplateSpan:
                return updateTemplateSpan(<TemplateSpan>node,
                    visitNode((<TemplateSpan>node).expression, visitor, isExpression),
                    visitNode((<TemplateSpan>node).literal, visitor, isTemplateLiteralFragment));

            // Element
            case SyntaxKind.Block:
                return updateBlock((<Block>node),
                    visitNodes((<Block>node).statements, visitor, isStatement));

            case SyntaxKind.VariableStatement:
                return updateVariableStatement((<VariableStatement>node),
                    visitNodes((<VariableStatement>node).modifiers, visitor, isModifier),
                    visitNode((<VariableStatement>node).declarationList, visitor, isVariableDeclarationList));

            case SyntaxKind.ExpressionStatement:
                return updateStatement((<ExpressionStatement>node),
                    visitNode((<ExpressionStatement>node).expression, visitor, isExpression));

            case SyntaxKind.IfStatement:
                return updateIf((<IfStatement>node),
                    visitNode((<IfStatement>node).expression, visitor, isExpression),
                    visitNode((<IfStatement>node).thenStatement, visitor, isStatement, /*optional*/ false, liftToBlock),
                    visitNode((<IfStatement>node).elseStatement, visitor, isStatement, /*optional*/ true, liftToBlock));

            case SyntaxKind.DoStatement:
                return updateDo(<DoStatement>node,
                    visitNode((<DoStatement>node).statement, visitor, isStatement, /*optional*/ false, liftToBlock),
                    visitNode((<DoStatement>node).expression, visitor, isExpression));

            case SyntaxKind.WhileStatement:
                return updateWhile(<WhileStatement>node,
                    visitNode((<WhileStatement>node).expression, visitor, isExpression),
                    visitNode((<WhileStatement>node).statement, visitor, isStatement, /*optional*/ false, liftToBlock));

            case SyntaxKind.ForStatement:
                return updateFor(<ForStatement>node,
                    visitNode((<ForStatement>node).initializer, visitor, isForInitializer),
                    visitNode((<ForStatement>node).condition, visitor, isExpression),
                    visitNode((<ForStatement>node).incrementor, visitor, isExpression),
                    visitNode((<ForStatement>node).statement, visitor, isStatement, /*optional*/ false, liftToBlock));

            case SyntaxKind.ForInStatement:
                return updateForIn(<ForInStatement>node,
                    visitNode((<ForInStatement>node).initializer, visitor, isForInitializer),
                    visitNode((<ForInStatement>node).expression, visitor, isExpression),
                    visitNode((<ForInStatement>node).statement, visitor, isStatement, /*optional*/ false, liftToBlock));

            case SyntaxKind.ForOfStatement:
                return updateForOf(<ForOfStatement>node,
                    visitNode((<ForOfStatement>node).initializer, visitor, isForInitializer),
                    visitNode((<ForOfStatement>node).expression, visitor, isExpression),
                    visitNode((<ForOfStatement>node).statement, visitor, isStatement, /*optional*/ false, liftToBlock));

            case SyntaxKind.ContinueStatement:
                return updateContinue(<ContinueStatement>node,
                    visitNode((<ContinueStatement>node).label, visitor, isIdentifier, /*optional*/ true));

            case SyntaxKind.BreakStatement:
                return updateBreak(<BreakStatement>node,
                    visitNode((<BreakStatement>node).label, visitor, isIdentifier, /*optional*/ true));

            case SyntaxKind.ReturnStatement:
                return updateReturn(<ReturnStatement>node,
                    visitNode((<ReturnStatement>node).expression, visitor, isExpression, /*optional*/ true));

            case SyntaxKind.WithStatement:
                return updateWith(<WithStatement>node,
                    visitNode((<WithStatement>node).expression, visitor, isExpression),
                    visitNode((<WithStatement>node).statement, visitor, isStatement, /*optional*/ false, liftToBlock));

            case SyntaxKind.SwitchStatement:
                return updateSwitch(<SwitchStatement>node,
                    visitNode((<SwitchStatement>node).expression, visitor, isExpression),
                    visitNode((<SwitchStatement>node).caseBlock, visitor, isCaseBlock));

            case SyntaxKind.LabeledStatement:
                return updateLabel(<LabeledStatement>node,
                    visitNode((<LabeledStatement>node).label, visitor, isIdentifier),
                    visitNode((<LabeledStatement>node).statement, visitor, isStatement, /*optional*/ false, liftToBlock));

            case SyntaxKind.ThrowStatement:
                return updateThrow(<ThrowStatement>node,
                    visitNode((<ThrowStatement>node).expression, visitor, isExpression));

            case SyntaxKind.VariableDeclaration:
                return updateVariableDeclaration((<VariableDeclaration>node),
                    visitNode((<VariableDeclaration>node).name, visitor, isBindingName),
                    visitNode((<VariableDeclaration>node).type, visitor, isTypeNode, /*optional*/ true),
                    visitNode((<VariableDeclaration>node).initializer, visitor, isExpression, /*optional*/ true));

            case SyntaxKind.VariableDeclarationList:
                return updateVariableDeclarationList((<VariableDeclarationList>node),
                    visitNodes((<VariableDeclarationList>node).declarations, visitor, isVariableDeclaration));

            case SyntaxKind.FunctionDeclaration:
                return updateFunctionDeclaration(<FunctionDeclaration>node,
                    visitNodes((<FunctionDeclaration>node).decorators, visitor, isDecorator),
                    visitNodes((<FunctionDeclaration>node).modifiers, visitor, isModifier),
                    visitNode((<FunctionDeclaration>node).name, visitor, isPropertyName),
                    visitNodes((<FunctionDeclaration>node).typeParameters, visitor, isTypeParameter),
                    startLexicalEnvironmentAndVisitParameters((<FunctionDeclaration>node).parameters, visitor, context),
                    visitNode((<FunctionDeclaration>node).type, visitor, isTypeNode, /*optional*/ true),
                    endLexicalEnvironmentAndUpdateBody(
                        visitNode((<FunctionDeclaration>node).body, visitor, isFunctionBody, /*optional*/ true),
                        context));

            case SyntaxKind.ClassDeclaration:
                return updateClassDeclaration(<ClassDeclaration>node,
                    visitNodes((<ClassDeclaration>node).decorators, visitor, isDecorator),
                    visitNodes((<ClassDeclaration>node).modifiers, visitor, isModifier),
                    visitNode((<ClassDeclaration>node).name, visitor, isIdentifier, /*optional*/ true),
                    visitNodes((<ClassDeclaration>node).typeParameters, visitor, isTypeParameter),
                    visitNodes((<ClassDeclaration>node).heritageClauses, visitor, isHeritageClause),
                    visitNodes((<ClassDeclaration>node).members, visitor, isClassElement));

            case SyntaxKind.CaseBlock:
                return updateCaseBlock(<CaseBlock>node,
                    visitNodes((<CaseBlock>node).clauses, visitor, isCaseOrDefaultClause));

            // Clauses
            case SyntaxKind.CaseClause:
                return updateCaseClause(<CaseClause>node,
                    visitNode((<CaseClause>node).expression, visitor, isExpression),
                    visitNodes((<CaseClause>node).statements, visitor, isStatement));

            case SyntaxKind.DefaultClause:
                return updateDefaultClause(<DefaultClause>node,
                    visitNodes((<DefaultClause>node).statements, visitor, isStatement));

            case SyntaxKind.HeritageClause:
                return updateHeritageClause(<HeritageClause>node,
                    visitNodes((<HeritageClause>node).types, visitor, isExpressionWithTypeArguments));

            // Property assignments
            case SyntaxKind.PropertyAssignment:
                return updatePropertyAssignment(<PropertyAssignment>node,
                    visitNode((<PropertyAssignment>node).name, visitor, isPropertyName),
                    visitNode((<PropertyAssignment>node).initializer, visitor, isExpression));

            case SyntaxKind.ShorthandPropertyAssignment:
                return updateShorthandPropertyAssignment(<ShorthandPropertyAssignment>node,
                    visitNode((<ShorthandPropertyAssignment>node).name, visitor, isIdentifier),
                    visitNode((<ShorthandPropertyAssignment>node).objectAssignmentInitializer, visitor, isExpression));

            // Top-level nodes
            case SyntaxKind.SourceFile:
                context.startLexicalEnvironment();
                return updateSourceFileNode((<SourceFile>node),
                    createNodeArray(
                        concatenate(
                            visitNodes((<SourceFile>node).statements, visitor, isStatement),
                            context.endLexicalEnvironment()),
                        (<SourceFile>node).statements));

            // Transformation nodes
            case SyntaxKind.PartiallyEmittedExpression:
                return updatePartiallyEmittedExpression(<PartiallyEmittedExpression>node,
                    visitNode((<PartiallyEmittedExpression>node).expression, visitor, isExpression));

            default:
                let updated: Node & Map<any>;
                const edgeTraversalPath = nodeEdgeTraversalMap[kind];
                if (edgeTraversalPath) {
                    for (const edge of edgeTraversalPath) {
                        const value = <Node | NodeArray<Node>>(<Node & Map<any>>node)[edge.name];
                        if (value !== undefined) {
                            const visited = isArray(value)
                                ? visitNodes(value, visitor, edge.test, 0, value.length, edge.parenthesize, node)
                                : visitNode(value, visitor, edge.test, edge.optional, edge.lift, edge.parenthesize, node);
                            if (updated !== undefined || visited !== value) {
                                if (updated === undefined) {
                                    updated = getMutableClone(node);
                                }
                                if (visited !== value) {
                                    updated[edge.name] = visited;
                                }
                            }
                        }
                    }
                }
                return updated ? updateNode(updated, node) : node;
        }
    }

    function startLexicalEnvironmentAndVisitParameters(nodes: NodeArray<ParameterDeclaration>, visitor: (node: Node) => VisitResult<Node>, context: LexicalEnvironment): NodeArray<ParameterDeclaration> {
        context.startLexicalEnvironment();
        return visitNodes(nodes, visitor, isParameter);
    }

    function endLexicalEnvironmentAndUpdateBody(body: FunctionBody, context: LexicalEnvironment): FunctionBody;
    function endLexicalEnvironmentAndUpdateBody(body: ConciseBody, context: LexicalEnvironment): ConciseBody;
    function endLexicalEnvironmentAndUpdateBody(body: ConciseBody, context: LexicalEnvironment) {
        const declarations = context.endLexicalEnvironment();
        if (body && declarations && declarations.length) {
            if (isBlock(body)) {
                return updateBlock(body, createNodeArray(concatenate(body.statements, declarations), body.statements));
            }
            return createBlock(
                createNodeArray([createReturn(body, /*location*/ body), ...declarations], body),
                /*location*/ body,
                /*multiLine*/ true);
        }
        return body;
    }

    /**
     * Appends a node to an array.
     *
     * @param to The destination array.
     * @param from The source Node or NodeArrayNode.
     */
    export function addNode<T extends Node>(to: T[], from: VisitResult<T>, startOnNewLine?: boolean): void;
    export function addNode(to: Node[], from: VisitResult<Node>, startOnNewLine: boolean, test: (node: Node) => boolean, parenthesize: (node: Node, parentNode: Node) => Node, parentNode: Node, isVisiting: boolean): void;
    export function addNode(to: Node[], from: VisitResult<Node>, startOnNewLine?: boolean, test?: (node: Node) => boolean, parenthesize?: (node: Node, parentNode: Node) => Node, parentNode?: Node, isVisiting?: boolean): void {
        if (to && from) {
            if (isArray(from)) {
                addNodes(to, from, startOnNewLine, test, parenthesize, parentNode, isVisiting);
            }
            else {
                const node = parenthesize !== undefined
                    ? parenthesize(from, parentNode)
                    : from;

                Debug.assertNode(node, test);

                if (startOnNewLine) {
                    node.startsOnNewLine = true;
                }

                if (isVisiting) {
                    aggregateTransformFlags(node);
                }

                to.push(node);
            }
        }
    }

    /**
     * Appends an array of nodes to an array.
     *
     * @param to The destination NodeArray.
     * @param from The source array of Node or NodeArrayNode.
     */
    export function addNodes<T extends Node>(to: T[], from: VisitResult<T>[], startOnNewLine?: boolean): void;
    export function addNodes(to: Node[], from: VisitResult<Node>[], startOnNewLine: boolean, test: (node: Node) => boolean, parenthesize: (node: Node, parentNode: Node) => Node, parentNode: Node, isVisiting: boolean): void;
    export function addNodes(to: Node[], from: VisitResult<Node>[], startOnNewLine?: boolean, test?: (node: Node) => boolean, parenthesize?: (node: Node, parentNode: Node) => Node, parentNode?: Node, isVisiting?: boolean): void {
        if (to && from) {
            for (const node of from) {
                addNode(to, node, startOnNewLine, test, parenthesize, parentNode, isVisiting);
            }
        }
    }

    /**
     * Merges generated lexical declarations into the FunctionBody of a non-arrow function-like declaration.
     *
     * @param node The ConciseBody of an arrow function.
     * @param declarations The lexical declarations to merge.
     */
    export function mergeFunctionBodyLexicalEnvironment(body: FunctionBody, declarations: Statement[]): FunctionBody {
        if (declarations !== undefined && declarations.length > 0) {
            return mergeBlockLexicalEnvironment(body, declarations);
        }

        return body;
    }

    /**
     * Merges generated lexical declarations into the ConciseBody of an ArrowFunction.
     *
     * @param node The ConciseBody of an arrow function.
     * @param declarations The lexical declarations to merge.
     */
    export function mergeConciseBodyLexicalEnvironment(body: ConciseBody, declarations: Statement[]): ConciseBody {
        if (declarations !== undefined && declarations.length > 0) {
            if (isBlock(body)) {
                return mergeBlockLexicalEnvironment(body, declarations);
            }
            else {
                return createBlock([
                    createReturn(body),
                    ...declarations
                ]);
            }
        }

        return body;
    }

    /**
     * Merge generated declarations of a lexical environment into a FunctionBody or ModuleBlock.
     *
     * @param node The block into which to merge lexical declarations.
     * @param declarations The lexical declarations to merge.
     */
    function mergeBlockLexicalEnvironment<T extends Block>(node: T, declarations: Statement[]): T {
        const mutableNode = getMutableClone(node);
        mutableNode.statements = mergeStatements(node.statements, declarations);
        return mutableNode;
    }

    /**
     * Merge generated declarations of a lexical environment into a NodeArray of Statement.
     *
     * @param statements The node array to concatentate with the supplied lexical declarations.
     * @param declarations The lexical declarations to merge.
     */
    function mergeStatements(statements: NodeArray<Statement>, declarations: Statement[]): NodeArray<Statement> {
        return createNodeArray(concatenate(statements, declarations), /*location*/ statements);
    }

    /**
     * Lifts a NodeArray containing only Statement nodes to a block.
     *
     * @param nodes The NodeArray.
     */
    export function liftToBlock(nodes: Node[]): Statement {
        Debug.assert(every(nodes, isStatement), "Cannot lift nodes to a Block.");
        return <Statement>singleOrUndefined(nodes) || createBlock(<NodeArray<Statement>>nodes);
    }

    /**
     * Extracts the single node from a NodeArray.
     *
     * @param nodes The NodeArray.
     */
    function extractSingleNode(nodes: Node[]): Node {
        Debug.assert(nodes.length <= 1, "Too many nodes written to output.");
        return singleOrUndefined(nodes);
    }

    /**
     * Aggregates the TransformFlags for a Node and its subtree.
     */
    export function aggregateTransformFlags(node: Node): void {
        aggregateTransformFlagsForNode(node);
    }

    /**
     * Aggregates the TransformFlags for a Node and its subtree. The flags for the subtree are
     * computed first, then the transform flags for the current node are computed from the subtree
     * flags and the state of the current node. Finally, the transform flags of the node are
     * returned, excluding any flags that should not be included in its parent node's subtree
     * flags.
     */
    function aggregateTransformFlagsForNode(node: Node): TransformFlags {
        if (node === undefined) {
            return TransformFlags.None;
        }
        else if (node.transformFlags & TransformFlags.HasComputedFlags) {
            return node.transformFlags & ~getTransformFlagsSubtreeExclusions(node.kind);
        }
        else {
            const subtreeFlags = aggregateTransformFlagsForSubtree(node);
            return computeTransformFlagsForNode(node, subtreeFlags);
        }
    }

    /**
     * Aggregates the transform flags for the subtree of a node.
     */
    function aggregateTransformFlagsForSubtree(node: Node): TransformFlags {
        // We do not transform ambient declarations or types, so there is no need to
        // recursively aggregate transform flags.
        if (hasModifier(node, ModifierFlags.Ambient) || isTypeNode(node)) {
            return TransformFlags.None;
        }

        // Aggregate the transform flags of each child.
        return reduceEachChild(node, aggregateTransformFlagsForChildNode, TransformFlags.None);
    }

    /**
     * Aggregates the TransformFlags of a child node with the TransformFlags of its
     * siblings.
     */
    function aggregateTransformFlagsForChildNode(transformFlags: TransformFlags, child: Node): TransformFlags {
        return transformFlags | aggregateTransformFlagsForNode(child);
    }

    /**
     * Gets the transform flags to exclude when unioning the transform flags of a subtree.
     *
     * NOTE: This needs to be kept up-to-date with the exclusions used in `computeTransformFlagsForNode`.
     *       For performance reasons, `computeTransformFlagsForNode` uses local constant values rather
     *       than calling this function.
     */
    function getTransformFlagsSubtreeExclusions(kind: SyntaxKind) {
        if (kind >= SyntaxKind.FirstTypeNode && kind <= SyntaxKind.LastTypeNode) {
            return TransformFlags.TypeExcludes;
        }

        switch (kind) {
            case SyntaxKind.CallExpression:
            case SyntaxKind.NewExpression:
            case SyntaxKind.ArrayLiteralExpression:
                return TransformFlags.ArrayLiteralOrCallOrNewExcludes;
            case SyntaxKind.ModuleDeclaration:
                return TransformFlags.ModuleExcludes;
            case SyntaxKind.Parameter:
                return TransformFlags.ParameterExcludes;
            case SyntaxKind.ArrowFunction:
                return TransformFlags.ArrowFunctionExcludes;
            case SyntaxKind.FunctionExpression:
            case SyntaxKind.FunctionDeclaration:
                return TransformFlags.FunctionExcludes;
            case SyntaxKind.VariableDeclarationList:
                return TransformFlags.VariableDeclarationListExcludes;
            case SyntaxKind.ClassDeclaration:
            case SyntaxKind.ClassExpression:
                return TransformFlags.ClassExcludes;
            case SyntaxKind.Constructor:
                return TransformFlags.ConstructorExcludes;
            case SyntaxKind.MethodDeclaration:
            case SyntaxKind.GetAccessor:
            case SyntaxKind.SetAccessor:
                return TransformFlags.MethodOrAccessorExcludes;
            case SyntaxKind.AnyKeyword:
            case SyntaxKind.NumberKeyword:
            case SyntaxKind.NeverKeyword:
            case SyntaxKind.StringKeyword:
            case SyntaxKind.BooleanKeyword:
            case SyntaxKind.SymbolKeyword:
            case SyntaxKind.VoidKeyword:
            case SyntaxKind.TypeParameter:
            case SyntaxKind.PropertySignature:
            case SyntaxKind.MethodSignature:
            case SyntaxKind.CallSignature:
            case SyntaxKind.ConstructSignature:
            case SyntaxKind.IndexSignature:
            case SyntaxKind.InterfaceDeclaration:
            case SyntaxKind.TypeAliasDeclaration:
                return TransformFlags.TypeExcludes;
            case SyntaxKind.ObjectLiteralExpression:
                return TransformFlags.ObjectLiteralExcludes;
            default:
                return TransformFlags.NodeExcludes;
        }
    }

    export namespace Debug {
        export const failNotOptional = shouldAssert(AssertionLevel.Normal)
            ? (message?: string) => assert(false, message || "Node not optional.")
            : (message?: string) => {};

        export const failBadSyntaxKind = shouldAssert(AssertionLevel.Normal)
            ? (node: Node, message?: string) => assert(false, message || "Unexpected node.", () => `Node ${formatSyntaxKind(node.kind)} was unexpected.`)
            : (node: Node, message?: string) => {};

        export const assertNode = shouldAssert(AssertionLevel.Normal)
            ? (node: Node, test: (node: Node) => boolean, message?: string) => assert(
                    test === undefined || test(node),
                    message || "Unexpected node.",
                    () => `Node ${formatSyntaxKind(node.kind)} did not pass test '${getFunctionName(test)}'.`)
            : (node: Node, test: (node: Node) => boolean, message?: string) => {};

        function getFunctionName(func: Function) {
            if (typeof func !== "function") {
                return "";
            }
            else if (func.hasOwnProperty("name")) {
                return (<any>func).name;
            }
            else {
                const text = Function.prototype.toString.call(func);
                const match = /^function\s+([\w\$]+)\s*\(/.exec(text);
                return match ? match[1] : "";
            }
        }
    }
}