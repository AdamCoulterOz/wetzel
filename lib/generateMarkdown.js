"use strict";
var fs = require('fs');
var path = require('path');
var defined = require('./defined');
var defaultValue = require('./defaultValue');
var sortObject = require('./sortObject');
var clone = require('./clone');
var style = require('./style');
var schema3 = require('./schema3Resolver');
var schema4 = require('./schema4Resolver');

module.exports = generateMarkdown;

/**
* @function generateMarkdown
* Generates the markdown content to represent the json schema provided within the options parameter.
* @param  {object} options - The set of configuration options to be fed into the generator.
* @return {string} The full markdown content based on the requested options.
*/
function generateMarkdown(options) {
    var md = '';
    var schema = options.schema;
    options.basePath = defaultValue(options.basePath, '');

    // Verify JSON Schema version
    var schemaRef = schema.$schema;
    var resolved = null;
    if (defined(schemaRef)) {
        if (schemaRef === 'http://json-schema.org/draft-03/schema') {
            resolved = schema3.resolve(schema, options.fileName, options.basePath, options.debug);
        }
        else if (schemaRef === 'http://json-schema.org/draft-04/schema') {
            resolved = schema4.resolve(schema, options.fileName, options.basePath, options.debug);
        }
        else
        {
            resolved = schema3.resolve(schema, options.fileName, options.basePath, options.debug);
            md += '> WETZEL_WARNING: Only JSON Schema 3 or 4 is supported. Treating as Schema 3.\n\n';
        }
    }

    schema = resolved.schema;
    var orderedTypes = sortObject(resolved.referencedSchemas);

    // We need the reverse-sorted version so that when we do type searching we find the longest type first.
    var orderedTypesDescending = sortObject(resolved.referencedSchemas, false);

    md += getTableOfContentsMarkdown(schema, orderedTypes, options.headerLevel);

    for (var type in orderedTypes) {
        md += '\n\n';
        md += getSchemaMarkdown(
            orderedTypes[type].schema,
            orderedTypes[type].fileName,
            options.headerLevel + 1,
            options.suppressWarnings,
            options.schemaRelativeBasePath,
            orderedTypesDescending);
    }
    
    return md;
}

////////////////////////////////////////////////////////////////////////////////

/**
* @function getTableOfContentsMarkdown
* Print a table of contents indicating (and linking to) all of the types that are documented
* @param  {object} schema       The root schema that the documentation is for.
* @param  {object} orderedTypes The ordered collection of types for the TOC.
* @param  {int} headerLevel     The level that the header for the TOC should be displayed at.
* @return {string} The markdown for the table of contents.
*/
function getTableOfContentsMarkdown(schema, orderedTypes, headerLevel) {
    var md = style.getHeaderMarkdown(headerLevel) + ' Objects\n';
    for (var type in orderedTypes) {
        md += style.bulletItem(style.linkType('`' + type + '`', type) + (type === schema.title ? ' (root object)' : ''));
    }

    return md;
}

/**
* @function getSchemaMarkdown
* Gets the markdown for the first-class elements of a schema.
* @param  {object} schema                 The schema being converted to markdown.
* @param  {string} fileName               The filename of the schema being converted to markdown.
* @param  {int} headerLevel               The starting level for the headers.
* @param  {boolean} suppressWarnings      Indicates if wetzel warnings should be printed in the documentation.
* @param  {string} schemaRelativeBasePath The path, relative to where this documentation lives, that the schema files can be found.
* Leave as null if you don't want the documentation to link to the schema files. 
* @param  {object} knownTypes             The dictionary of types and their schema information.
* @return {string}                        The markdown for the schema.
*/
function getSchemaMarkdown(schema, fileName, headerLevel, suppressWarnings, schemaRelativeBasePath, knownTypes) {
    var md = '';

    // Render section header
    var title = defaultValue(schema.title, suppressWarnings ? '' : 'WETZEL_WARNING: title not defined');
    md += style.getSectionMarkdown(title, headerLevel);

    // Render description
    var value = autoLinkDescription(schema.description, knownTypes);
    if (defined(value)) {
        md += value + '\n\n';
    }

    // Render type
    var schemaType = schema.type;
    if (defined(schemaType)) {
        //      md += styleType('Type') + ': ' + style.typeValue(schemaType) + '\n\n';
    }

    // TODO: Add plugin point for custom JSON schema properties like gltf_*
    var webgl = schema.gltf_webgl;
    if (defined(webgl)) {
        md += style.propertyGltfWebGL('Related WebGL functions') + ': ' + webgl + '\n\n';
    }

    // Render each property if the type is object
    if (schemaType === 'object') {
        // Render table with summary of each property
        md += createPropertiesSummary(schema, knownTypes);

        value = schema.additionalProperties;
        if (defined(value) && !value) {
            md += 'Additional properties are not allowed.\n\n';
        } else {
            md += 'Additional properties are allowed.\n\n';
            // TODO: display their schema
        }

        // Schema reference
        if (defined(schemaRelativeBasePath))
        {
            md += style.bulletItem(style.bold('JSON schema') + ': ' + style.getLinkMarkdown(fileName, path.join(schemaRelativeBasePath, fileName).replace(/\\/g, '/'))) + '\n';

            // TODO: figure out how to auto-determine example reference
            //* **Example**: [bufferViews.json](schema/examples/bufferViews.json)
        }

        // Render section for each property
        md += createPropertiesDetails(schema, title, headerLevel + 1, knownTypes);
    }

    return md;
}

////////////////////////////////////////////////////////////////////////////////

function createPropertiesSummary(schema, knownTypes) {
    var md = '';

    md += style.propertiesSummary('Properties') + '\n\n';
    md += '|   |Type|Description|Required|\n';
    md += '|---|----|-----------|--------|\n';

    var properties = schema.properties;
    for (var name in properties) {
        if (properties.hasOwnProperty(name)) {
            var property = properties[name];
            var summary = getPropertySummary(property, knownTypes);

            md += '|' + style.propertyNameSummary(name) +
                '|' + summary.formattedType +
                '|' + defaultValue(summary.description, '') +
                '|' + (summary.required === 'Yes' ? style.requiredIcon : '') + summary.required + '|\n';
        }
    }

    md += '\n';

    return md;
}

function createPropertiesDetails(schema, title, headerLevel, knownTypes) {
    var headerMd = style.getHeaderMarkdown(headerLevel);
    var md = '';

    var properties = schema.properties;
    for (var name in properties) {
        if (properties.hasOwnProperty(name)) {
            var property = properties[name];
            var type = property.type;
            var summary = getPropertySummary(property, knownTypes);

            md += headerMd + ' ' + title + '.' + name + (summary.required === 'Yes' ? style.requiredIcon : '') + '\n\n';

            // TODO: Add plugin point for custom JSON schema properties like gltf_*
            var detailedDescription = autoLinkDescription(property.gltf_detailedDescription, knownTypes);
            if (defined(detailedDescription)) {
                md += detailedDescription + '\n\n';
            } else if (defined(summary.description)) {
                md += summary.description + '\n\n';
            }

            md += '* ' + style.propertyDetails('Type') + ': ' + summary.formattedType + '\n';

            var uniqueItems = property.uniqueItems;
            if (defined(uniqueItems) && uniqueItems) {
                md += '   * Each element in the array must be unique.\n';
            }

            // TODO: items is a full schema
            var items = property.items;
            if (defined(items)) {
                var itemsExclusiveMinimum = (defined(items.exclusiveMinimum) && items.exclusiveMinimum);
                var minString = itemsExclusiveMinimum ? 'greater than' : 'greater than or equal to';

                var itemsExclusiveMaximum = (defined(items.exclusiveMaximum) && items.exclusiveMaximum);
                var maxString = itemsExclusiveMaximum ? 'less than' : 'less than or equal to';

                if (defined(items.minimum) && defined(items.maximum)) {
                    md += '   * Each element in the array must be ' + minString + ' ' + style.minMax(items.minimum) + ' and ' + maxString + ' ' + style.minMax(items.maximum) + '.\n';
                } else if (defined(items.minimum)) {
                    md += '   * Each element in the array must be ' + minString + ' ' + style.minMax(items.minimum) + '.\n';
                } else if (defined(items.maximum)) {
                    md += '   * Each element in the array must be ' + maxString + ' ' + style.minMax(items.maximum) + '.\n';
                }

                if (defined(items.minLength) && defined(items.maxLength)) {
                    md += '   * Each element in the array must have length between ' + style.minMax(items.minLength) + ' and ' + style.minMax(items.maxLength) + '.\n';
                } else if (defined(items.minLength)) {
                    md += '   * Each element in the array must have length greater than or equal to ' + style.minMax(items.minLength) + '.\n';
                } else if (defined(items.maxLength)) {
                    md += '   * Each element in the array must have length less than or equal to ' + style.minMax(items.maxLength) + '.\n';
                }

                var itemsString = getEnumString(items, type);
                if (defined(itemsString)) {
                    md += '   * Each element in the array must be one of the following values: ' + itemsString + '.\n';
                }
            }

            md += '* ' + style.propertyDetails('Required') + ': ' + summary.required + '\n';

            var minimum = property.minimum;
            if (defined(minimum)) {
                var exclusiveMinimum = (defined(property.exclusiveMinimum) && property.exclusiveMinimum);
                md += '* ' + style.propertyDetails('Minimum') + ': ' + style.minMax((exclusiveMinimum ? ' > ' : ' >= ') + minimum) + '\n';
            }

            var maximum = property.maximum;
            if (defined(maximum)) {
                var exclusiveMaximum = (defined(property.exclusiveMaximum) && property.exclusiveMaximum);
                md += '* ' + style.propertyDetails('Maximum') + ': ' + style.minMax((exclusiveMaximum ? ' < ' : ' <= ') + maximum) + '\n';
            }

            var format = property.format;
            if (defined(format)) {
                md += '* ' + style.propertyDetails('Format') + ': ' + format + '\n';
            }

            // TODO: maxLength
            var minLength = property.minLength;
            if (defined(minLength)) {
                md += '* ' + style.propertyDetails('Minimum Length') + style.minMax(': >= ' + minLength) + '\n';
            }

            var enumString = getEnumString(property, type);
            if (defined(enumString)) {
                md += '* ' + style.propertyDetails('Allowed values') + ': ' + enumString + '\n';
            }

            var additionalProperties = property.additionalProperties;
            if (defined(additionalProperties) && (typeof additionalProperties === 'object')) {
                if (defined(additionalProperties.type)) {
                    // TODO: additionalProperties is really a full schema
                    var formattedType = style.typeValue(additionalProperties.type)
                    if ((additionalProperties.type === 'object') && defined(property.title))
                    {
                        formattedType = style.linkType(property.title, property.title);
                    }

                    md += '* ' + style.propertyDetails('Type of each property') + ': ' + formattedType + '\n';
                }
            }

            // TODO: Add plugin point for custom JSON schema properties like gltf_*
            var webgl = property.gltf_webgl;
            if (defined(webgl)) {
                md += '* ' + style.propertyGltfWebGL('Related WebGL functions') + ': ' + webgl + '\n';
            }

            md += '\n';
        }
    }
    md += '\n';

    return md;
}

function getPropertySummary(property, knownTypes) {
    var type = defaultValue(property.type, 'any');
    var formattedType = style.typeValue(type);

    if (type === 'array') {
        var insideBrackets = '';
        if ((defined(property.minItems)) && (property.minItems === property.maxItems)) {
            // Min and max are the same so the array is constant size
            insideBrackets = property.minItems;
        } else if (defined(property.minItems) && defined(property.maxItems)) {
            // Min and max define a range
            insideBrackets = property.minItems + '-' + property.maxItems;
        } else if (defined(property.minItems)) {
            // Only min is defined
            insideBrackets = property.minItems + '-*';
        } else if (defined(property.maxItems)) {
            // Only max is defined
            insideBrackets = '*-' + property.maxItems;
        }

        var arrayInfo = '[' + insideBrackets + ']';

        if (defined(property.items) && defined(property.items.type)) {
            if ((property.items.type === 'object') && defined(property.items.title)) {
                type = property.items.title;
                formattedType = style.linkType(type, type);

                type += arrayInfo;
                formattedType += style.typeValue(arrayInfo);
            } else {
                type = property.items.type + arrayInfo;
                formattedType = style.typeValue(type);
            }
        } else {
            type += arrayInfo;
            formattedType = style.typeValue(type);
        }
    }

    var description = autoLinkDescription(property.description, knownTypes);

    var required;
    if (defined(property.required) && (property.required)) {
        required = 'Yes';
    } else {
        var propertyDefault = property.default;
        if (defined(propertyDefault)) {
            var defaultString;
            if (Array.isArray(propertyDefault)) {
                defaultString = '[' + propertyDefault.toString() + ']';
            } else if (typeof propertyDefault === 'object') {
                defaultString = JSON.stringify(propertyDefault);
            } else {
                defaultString = propertyDefault;
            }

            required = 'No, default: ' + style.defaultValue(defaultString, type);
        } else {
            required = 'No';
        }
    }

    return {
        type: type,
        formattedType: formattedType,
        description: description,
        required: required
    };
}

function getEnumString(schema, type) {
    var propertyEnum = schema['enum'];
    if (!defined(propertyEnum)) {
        return undefined;
    }

    var propertyEnumNames = schema['gltf_enumNames'];

    var allowedValues = '';
    var length = propertyEnum.length;
    for (var i = 0; i < length; ++i) {
        var element = propertyEnum[i];
        if (defined(propertyEnumNames)) {
            element += " (" + propertyEnumNames[i] + ")";
        }

        allowedValues += style.enumElement(element, type);
        if (i !== length - 1) {
            allowedValues += ', ';
        }
    }
    return allowedValues;
}

/**
* @function autoLinkDescription
* This will take a string that describes a type that may potentially reference _other_ types, and then
* automatically add markdown link refences to those other types inline. This is an admittedly simple
* (and potentially buggy) approach to the problem, but seems sufficient for the needs of glTF.
* @param  {type} description The string that should be auto-linked
* @param  {string[]} knownTypes  Array of known strings that are types that should be auto-linked if found.
* If there are multiple types with the same starting root string, it's imperative that the array is sorted such that the longer names are ordered first.
* @return {string} The auto-linked description.
*/
function autoLinkDescription(description, knownTypes) {
    for (var type in knownTypes) {
        description = style.linkType(description, type);
    }

    return description;
}