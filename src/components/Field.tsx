import React, { useEffect, useState } from 'react';
import { Icon, Paragraph, ValidationMessage } from '@contentful/forma-36-react-components';
import { CollectionResponse, FieldExtensionSDK, Link } from '@contentful/app-sdk';
// import '@contentful/forma-36-react-components/dist/styles.css';
import { CombinedLinkActions, MultipleEntryReferenceEditor } from '@contentful/field-editor-reference';
import { Entry } from '@contentful/field-editor-reference/dist/types';

interface FieldProps {
  sdk: FieldExtensionSDK;
}

enum CHECKING_STATUS {
  Initial = "INITIAL",
  Checking = "CHECKING",
  OK = "OK",
  Failed = "FAILED"
};

function checkPageReferences(sdk: FieldExtensionSDK, subhubId: string, pageId: string): Promise<Boolean> {
  // Fetch other subhubs that have links to this page.
  return sdk.space.getEntries({
    "content_type": "subHub",
    "fields.internalPages.sys.id": pageId,
    "sys.id[ne]": subhubId
  }).then((entries: CollectionResponse<Object>) => {
    console.table(entries.items);
    console.log(`Number of other subhub that contains this page: ${entries.items.length}`);
    return entries.items.length === 0;
  });
}

/**
 * Checks and returns if 
 * @param sdk The Contentful SDK.
 */
function checkSubhubPages(sdk: FieldExtensionSDK): Promise<boolean | Array<Link>> {
  const entryId = sdk.entry.getSys().id;
  const linkedPages = sdk.entry.fields["internalPages"].getValue() as Array<Link>;
  if (linkedPages.length === 0) {
    // If there are no linked pages in this SubHub, there aren't any problems.
    return Promise.resolve(true);
  }
  return Promise.all(linkedPages.map(page => {
    const pageId = page.sys.id;
    // Fetch other subhubs that have links to this page.
    return sdk.space.getEntries({
      "content_type": "subHub",
      "fields.internalPages.sys.id": pageId,
      "sys.id[ne]": entryId
    }).then((entries: CollectionResponse<Object>) => {
      console.table(entries.items);
      console.log(`Number of other subhub that contains this page: ${entries.items.length}`);
      return entries.items.length === 0 || page;
    });
    // return sdk.space.getEntry(page.sys.id).then(entry => {
    //   console.log(`${page.sys.id}`);
    //   console.table(entry);
    //   return true;
    // });
  })).then((results: Array<true | Link>) => {
    const failedPages = results.filter(value => value !== true);
    return failedPages.length === 0;
  });
}


const CircularSubhubValidator = ({ sdk }: FieldProps) => {
  const [status, setStatus] = useState(CHECKING_STATUS.Checking);
  useEffect(() => {
    const internalPagesField = sdk.field;
    function doCheckStatus() {
      setStatus(CHECKING_STATUS.Checking);
      checkSubhubPages(sdk).then(result => {
        if (result === true) {
          setStatus(CHECKING_STATUS.OK);
          internalPagesField.setInvalid(false);
        } else {
          setStatus(CHECKING_STATUS.Failed);
          internalPagesField.setInvalid(true);
        }
      });
    }
    // internalPagesField.onValueChanged(doCheckStatus);
    // doCheckStatus();
  }, [sdk, setStatus]);

  switch (status) {
    case CHECKING_STATUS.Checking:
      return <Paragraph>Checking...</Paragraph>;
    case CHECKING_STATUS.OK:
      return <Paragraph><Icon color="positive" icon="CheckCircle" /> No reference issues detected.</Paragraph>;
    case CHECKING_STATUS.Failed:
      return <ValidationMessage>One of your SubHub pages belongs to another SubHub that links back to the SubHub itself, forming a cycle. Please remove these page(s) from the SubHub. </ValidationMessage>;
    default:
      return <Paragraph>Checking...</Paragraph>;
  }
}

const Field = ({ sdk }: FieldProps) => {
  // If you only want to extend Contentful's default editing experience
  // reuse Contentful's editor components
  // -> https://www.contentful.com/developers/docs/extensibility/field-editors/
  // return <Paragraph>Hello Entry Field Component</Paragraph>;
  useEffect(() => {
    sdk.window.startAutoResizer();
  }, [sdk]);
  return <div>
    <MultipleEntryReferenceEditor
      viewType="link"
      hasCardEditActions={true}
      sdk={sdk}
      isInitiallyDisabled={true}
      parameters={{
        instance: {
          showCreateEntityAction: true,
          showLinkEntityAction: true,
        },
      }}
      renderCustomActions={
        props => {
          return <CombinedLinkActions
            {...props}

            onLinkExisting={index => {
              let contentTypes = []; // By default, all content types should be allowable in this collection.
              if (sdk.field.items && sdk.field.items.validations) {
                const contentTypeValidations = sdk.field.items.validations.filter(validation => validation.hasOwnProperty("linkContentType")) as Array<any>;
                contentTypes = contentTypeValidations.flatMap(validation => validation.linkContentType);
              }
              console.log(contentTypes);
              sdk.dialogs
                .selectMultipleEntries({
                  locale: sdk.field.locale,
                  contentTypes
                })
                .then((entries) => {
                  if (!entries || entries.length === 0) {
                    return;
                  }
                  // Check all entries are ok.
                  const subhubId = sdk.entry.getSys().id;
                  Promise.all(
                    entries.map(entry => checkPageReferences(sdk, subhubId, (entry as Entry).sys.id))
                  ).then(results => {
                    const failedEntries = entries.filter((entry, i) => !results[i]);
                    const okEntries = entries.filter((entry, i) => results[i]);
                    if (failedEntries.length === 0) {
                      // All OK! Will add all entries to entry list.
                      props.onLinkedExisting(entries as Entry[], index);
                      return;
                    } else {
                      sdk.dialogs.openAlert({
                        title: "Adding pages failed",
                        message: "Failed to add your pages. One of the pages you chose belongs to another SubHub that links back to the SubHub itself, forming a cycle."
                      });
                      return;
                    }
                  });
                });
            }}
          />
        }
      }
    />
    <CircularSubhubValidator sdk={sdk} />
  </div>;

};

export default Field;
