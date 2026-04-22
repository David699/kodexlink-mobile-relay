#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const sourcePath = path.resolve(repoRoot, "packages/protocol/src/messages.ts");
const outputPath = path.resolve(repoRoot, "ios/KodexLink/Core/Protocol/MessageTypes.swift");

const skipInterfaceNames = new Set(["TurnTextInputItem", "TurnImageInputItem"]);
const skipTypeAliasNames = new Set(["DeviceType", "TurnInputItem", "AppMessage"]);

const inlineEnumNameByProperty = new Map([
  ["ThreadMessage.role", "ThreadMessageRole"],
  ["AgentPresencePayload.status", "AgentPresenceStatus"],
  ["AgentPresencePayload.reason", "AgentDegradedReason"]
]);

const propertyTypeOverrides = new Map([
  ["ThreadGitInfo.sha", "String?"],
  ["ThreadGitInfo.branch", "String?"],
  ["ThreadGitInfo.originUrl", "String?"]
]);

const propertyDefaultValueOverrides = new Map([["AuthPayload.runtimeType", "nil"]]);

const typeReferenceOverrides = new Map([["DeviceType", "String"]]);

function hasExportModifier(node) {
  return Boolean(node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
}

function toCamelCaseCaseName(rawValue) {
  let value = rawValue;
  if (value.includes("_") || value.includes("-") || value.includes(" ")) {
    const words = value
      .split(/[_\-\s]+/)
      .filter(Boolean)
      .map((word) => word.toLowerCase());
    value = words
      .map((word, index) => (index === 0 ? word : `${word[0].toUpperCase()}${word.slice(1)}`))
      .join("");
  }

  if (!value) {
    value = "unknown";
  }

  if (!/^[A-Za-z_]/.test(value)) {
    value = `value${value}`;
  }

  if (["default", "switch", "case", "class", "struct", "enum", "protocol", "Type"].includes(value)) {
    return `\`${value}\``;
  }

  return value;
}

function readUnionStringLiterals(unionTypeNode) {
  if (!ts.isUnionTypeNode(unionTypeNode)) {
    return null;
  }

  const values = [];
  for (const member of unionTypeNode.types) {
    if (!ts.isLiteralTypeNode(member) || !ts.isStringLiteral(member.literal)) {
      return null;
    }
    values.push(member.literal.text);
  }
  return values;
}

function isNullLikeType(typeNode) {
  return (
    typeNode.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isLiteralTypeNode(typeNode) && typeNode.literal.kind === ts.SyntaxKind.NullKeyword)
  );
}

function swiftTypeFromTypeNode(typeNode, context) {
  if (!typeNode) {
    return { swiftType: "String", isOptionalByType: false };
  }

  if (ts.isParenthesizedTypeNode(typeNode)) {
    return swiftTypeFromTypeNode(typeNode.type, context);
  }

  if (ts.isTypeReferenceNode(typeNode)) {
    const refName = typeNode.typeName.getText();
    if (typeReferenceOverrides.has(refName)) {
      return { swiftType: typeReferenceOverrides.get(refName), isOptionalByType: false };
    }
    return { swiftType: refName, isOptionalByType: false };
  }

  if (ts.isArrayTypeNode(typeNode)) {
    const itemType = swiftTypeFromTypeNode(typeNode.elementType, context);
    return { swiftType: `[${itemType.swiftType}]`, isOptionalByType: false };
  }

  if (ts.isUnionTypeNode(typeNode)) {
    const nullFiltered = typeNode.types.filter((member) => !isNullLikeType(member));
    const hasNullMember = nullFiltered.length !== typeNode.types.length;
    if (hasNullMember && nullFiltered.length === 1) {
      const unwrapped = swiftTypeFromTypeNode(nullFiltered[0], context);
      return { swiftType: unwrapped.swiftType, isOptionalByType: true };
    }

    const literalValues = readUnionStringLiterals(typeNode);
    if (literalValues) {
      const enumKey = `${context.interfaceName}.${context.propertyName}`;
      const mappedEnumName = inlineEnumNameByProperty.get(enumKey);
      if (mappedEnumName) {
        return {
          swiftType: mappedEnumName,
          isOptionalByType: false,
          inlineEnum: {
            name: mappedEnumName,
            values: literalValues
          }
        };
      }

      return { swiftType: "String", isOptionalByType: false };
    }

    return { swiftType: "String", isOptionalByType: false };
  }

  if (typeNode.kind === ts.SyntaxKind.StringKeyword) {
    return { swiftType: "String", isOptionalByType: false };
  }

  if (typeNode.kind === ts.SyntaxKind.NumberKeyword) {
    return { swiftType: "Int", isOptionalByType: false };
  }

  if (typeNode.kind === ts.SyntaxKind.BooleanKeyword) {
    return { swiftType: "Bool", isOptionalByType: false };
  }

  if (ts.isLiteralTypeNode(typeNode) && ts.isStringLiteral(typeNode.literal)) {
    return { swiftType: "String", isOptionalByType: false };
  }

  if (
    ts.isLiteralTypeNode(typeNode) &&
    (typeNode.literal.kind === ts.SyntaxKind.TrueKeyword ||
      typeNode.literal.kind === ts.SyntaxKind.FalseKeyword)
  ) {
    return { swiftType: "Bool", isOptionalByType: false };
  }

  return { swiftType: "String", isOptionalByType: false };
}

function conformancesForStruct(name) {
  const conformances = ["Codable"];
  if (name === "ThreadSummary" || name === "ThreadGitInfo") {
    conformances.push("Hashable");
  }
  if (name === "ThreadSummary" || name === "ThreadMessage") {
    conformances.push("Identifiable");
  }
  return conformances.join(", ");
}

function renderEnum(enumInfo) {
  const lines = [];
  lines.push(`enum ${enumInfo.name}: String, Codable, Equatable {`);
  for (const rawValue of enumInfo.values) {
    const caseName = toCamelCaseCaseName(rawValue);
    if (caseName.replaceAll("`", "") === rawValue) {
      lines.push(`    case ${caseName}`);
    } else {
      lines.push(`    case ${caseName} = "${rawValue}"`);
    }
  }
  lines.push("}");
  return lines.join("\n");
}

function renderStruct(structInfo) {
  const lines = [];
  lines.push(`struct ${structInfo.name}: ${conformancesForStruct(structInfo.name)} {`);
  for (const property of structInfo.properties) {
    const defaultValue =
      propertyDefaultValueOverrides.get(`${structInfo.name}.${property.name}`) ?? null;
    if (defaultValue) {
      lines.push(`    let ${property.name}: ${property.swiftType} = ${defaultValue}`);
    } else {
      lines.push(`    let ${property.name}: ${property.swiftType}`);
    }
  }
  lines.push("}");
  return lines.join("\n");
}

function renderTurnInputItem() {
  return [
    "struct TurnInputItem: Codable, Equatable {",
    "    let type: String",
    "    let text: String?",
    "    let url: String?",
    "",
    "    static func text(_ value: String) -> TurnInputItem {",
    '        TurnInputItem(type: "text", text: value, url: nil)',
    "    }",
    "",
    "    static func image(url: String) -> TurnInputItem {",
    '        TurnInputItem(type: "image", text: nil, url: url)',
    "    }",
    "}"
  ].join("\n");
}

function renderThreadSummaryExtension() {
  return [
    "extension ThreadSummary {",
    "    var titleText: String {",
    "        let trimmedPreview = preview.trimmingCharacters(in: .whitespacesAndNewlines)",
    "        return trimmedPreview.isEmpty ? cwd : trimmedPreview",
    "    }",
    "",
    "    var subtitleText: String {",
    "        cwd",
    "    }",
    "",
    "    var createdAtDate: Date {",
    "        Date(timeIntervalSince1970: TimeInterval(createdAt))",
    "    }",
    "}"
  ].join("\n");
}

function renderThreadMessageExtension() {
  return [
    "extension ThreadMessage {",
    "    var createdAtDate: Date? {",
    "        guard let createdAt else {",
    "            return nil",
    "        }",
    "",
    "        return Date(timeIntervalSince1970: TimeInterval(createdAt))",
    "    }",
    "}"
  ].join("\n");
}

async function main() {
  const sourceCode = await fs.readFile(sourcePath, "utf8");
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceCode,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  const enumsByName = new Map();
  const enumOrder = [];
  const structs = [];

  for (const statement of sourceFile.statements) {
    if (!hasExportModifier(statement)) {
      continue;
    }

    if (ts.isTypeAliasDeclaration(statement)) {
      const aliasName = statement.name.text;
      if (skipTypeAliasNames.has(aliasName)) {
        continue;
      }

      const literalUnion = readUnionStringLiterals(statement.type);
      if (!literalUnion) {
        continue;
      }

      if (!enumsByName.has(aliasName)) {
        enumsByName.set(aliasName, {
          name: aliasName,
          values: literalUnion
        });
        enumOrder.push(aliasName);
      }
      continue;
    }

    if (ts.isInterfaceDeclaration(statement)) {
      const interfaceName = statement.name.text;
      if (skipInterfaceNames.has(interfaceName)) {
        continue;
      }

      const properties = [];
      for (const member of statement.members) {
        if (!ts.isPropertySignature(member) || !member.type || !member.name) {
          continue;
        }

        const propertyName = ts.isIdentifier(member.name)
          ? member.name.text
          : ts.isStringLiteral(member.name)
            ? member.name.text
            : null;
        if (!propertyName) {
          continue;
        }

        const overrideType = propertyTypeOverrides.get(`${interfaceName}.${propertyName}`);
        if (overrideType) {
          properties.push({
            name: propertyName,
            swiftType: overrideType
          });
          continue;
        }

        const converted = swiftTypeFromTypeNode(member.type, {
          interfaceName,
          propertyName
        });

        if (converted.inlineEnum && !enumsByName.has(converted.inlineEnum.name)) {
          enumsByName.set(converted.inlineEnum.name, converted.inlineEnum);
          enumOrder.push(converted.inlineEnum.name);
        }

        const isOptional = Boolean(member.questionToken) || converted.isOptionalByType;
        properties.push({
          name: propertyName,
          swiftType: isOptional ? `${converted.swiftType}?` : converted.swiftType
        });
      }

      structs.push({
        name: interfaceName,
        properties
      });
    }
  }

  const structNames = new Set(structs.map((item) => item.name));
  if (!structNames.has("TurnInputItem")) {
    const turnStartIndex = structs.findIndex((item) => item.name === "TurnStartRequestPayload");
    const insertionIndex = turnStartIndex >= 0 ? turnStartIndex : structs.length;
    structs.splice(insertionIndex, 0, {
      name: "TurnInputItem",
      properties: []
    });
  }

  const lines = [];
  lines.push("// GENERATED FILE - DO NOT EDIT");
  lines.push("// Source: packages/protocol/src/messages.ts");
  lines.push("// Run: pnpm protocol:generate:swift");
  lines.push("");
  lines.push("import Foundation");
  lines.push("");

  for (const enumName of enumOrder) {
    const enumInfo = enumsByName.get(enumName);
    if (!enumInfo) {
      continue;
    }
    lines.push(renderEnum(enumInfo));
    lines.push("");
  }

  for (const structInfo of structs) {
    if (structInfo.name === "TurnInputItem") {
      lines.push(renderTurnInputItem());
      lines.push("");
      continue;
    }

    lines.push(renderStruct(structInfo));
    lines.push("");
  }

  lines.push(renderThreadSummaryExtension());
  lines.push("");
  lines.push(renderThreadMessageExtension());
  lines.push("");

  await fs.writeFile(outputPath, `${lines.join("\n")}`, "utf8");
}

void main().catch((error) => {
  process.stderr.write(
    `[generate-swift-message-types] ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
