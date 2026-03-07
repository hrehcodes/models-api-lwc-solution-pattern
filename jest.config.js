const { jestConfig } = require('@salesforce/sfdx-lwc-jest/config');

module.exports = {
    ...jestConfig,
    coveragePathIgnorePatterns: [
        ...(jestConfig.coveragePathIgnorePatterns || []),
        '/node_modules/'
    ]
};
