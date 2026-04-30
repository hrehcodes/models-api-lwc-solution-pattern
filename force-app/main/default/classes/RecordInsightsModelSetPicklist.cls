/**
 * Provides configured model-set names to Lightning App Builder.
 */
global with sharing class RecordInsightsModelSetPicklist extends VisualEditor.DynamicPickList {
    global override VisualEditor.DataRow getDefaultValue() {
        return new VisualEditor.DataRow('Default', 'Default');
    }

    global override VisualEditor.DynamicPickListRows getValues() {
        VisualEditor.DynamicPickListRows rows = new VisualEditor.DynamicPickListRows();
        for (String modelSetName : RecordAdvisorController.getAvailableModelSetNames()) {
            rows.addRow(new VisualEditor.DataRow(modelSetName, modelSetName));
        }
        return rows;
    }

    global override Boolean isValid(Object attributeValue) {
        return true;
    }

    global override String getLabel(Object attributeValue) {
        return attributeValue == null ? null : String.valueOf(attributeValue);
    }
}
