import React, { useEffect, useState } from 'react';
import { Icon, Paragraph, ValidationMessage } from '@contentful/forma-36-react-components';
import { CollectionResponse, EntrySys, FieldExtensionSDK, Link } from '@contentful/app-sdk';
import { CombinedLinkActions, MultipleEntryReferenceEditor } from '@contentful/field-editor-reference';
import { Entry } from '@contentful/field-editor-reference/dist/types';
import { LinkActionsProps } from '@contentful/field-editor-reference/dist/components';
import "./Field.css";

interface FieldProps {
  sdk: FieldExtensionSDK;
}

enum CHECKING_STATUS {
  Initial = "INITIAL",
  Checking = "CHECKING",
  OK = "OK",
  Failed = "FAILED"
};

function checkPageReferences(sdk: FieldExtensionSDK, subhubSys: EntrySys, pageSys: EntrySys): Promise<Boolean> {
  console.log(`Checking page reference for subhub ${subhubSys.id} and page ${pageSys.id}`);
  // First, check if the content author is trying to link a subhub to itself.
  if (subhubSys.type === pageSys.type && subhubSys.id === pageSys.id) {
    console.log("Subhub and page are the same, rejecting.");
    return Promise.resolve(false);
  }
  // Fetch other subhubs that have links to this page.
  return sdk.space.getEntries({
    "content_type": "subHub",
    "fields.internalPages.sys.id": pageSys.id,
    "sys.id[ne]": subhubSys.id
  }).then((entries: CollectionResponse<Object>) => {
    console.log(`Found ${entries.items.length} other Subhub(s) that contain this page.`);
    if (entries.items.length > 0) {
      console.log("Other SubHub(s) containing this page",entries.items);
    }
    return entries.items.length === 0;
  });
}

/**
 * Checks and returns if 
 * @param sdk The Contentful SDK.
 */
function checkSubhubPages(sdk: FieldExtensionSDK): Promise<boolean | Array<Link>> {
  const entrySys = sdk.entry.getSys();
  const linkedPages = sdk.entry.fields["internalPages"].getValue() || [] as Array<Link>;
  if (linkedPages.length === 0) {
    // If there are no linked pages in this SubHub, there aren't any problems.
    return Promise.resolve(true);
  }
  return Promise.all(linkedPages.map((page: Link) => {
    return sdk.space.getEntry(page.sys.id).then(pageEntry => {
      // Fetch other subhubs that have links to this page.
      return checkPageReferences(sdk, entrySys, (pageEntry as Entry).sys);
    });
  })).then((results: any []) => {
    const failedPages = (results as boolean[]).filter(value => !value);
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
    const removeValueChangedCb = internalPagesField.onValueChanged((value) => {
      console.log(`doCheckStatus called with ${value}.`);
      doCheckStatus();
    });
    doCheckStatus();
    return () => {
      removeValueChangedCb();
    }
  }, [sdk, setStatus]);

  switch (status) {
    case CHECKING_STATUS.Checking:
      return <Paragraph>Checking...</Paragraph>;
    case CHECKING_STATUS.OK:
      return null;
    case CHECKING_STATUS.Failed:
      return <ValidationMessage>Some of your SubHub pages belong(s) to another SubHub. Pages may only belong to one SubHub. Please remove these page(s) from the SubHub. </ValidationMessage>;
    default:
      return <Paragraph>Checking...</Paragraph>;
  }
}


const doFailedAlertDialog = (sdk: FieldExtensionSDK, hasMultiplePages: boolean, failedPageNames : string[]) => {
  const page = hasMultiplePages ? "pages" : "page";
  const failedPage = failedPageNames.length > 1 ? "these pages" : "this page";
  const failedPageList = failedPageNames.map(name => "\"" + name + "\"").join(", ");
  const nextStep = hasMultiplePages ? `Try adding ${failedPage} to the External Pages field instead: ${failedPageList}.` : "Try adding the page to the External Pages field instead."
  sdk.dialogs.openAlert({
    title: `Adding ${page} to SubHub Internal Pages field failed`,
    message: `Failed to add the ${page} you chose to the SubHub. Pages may only belong to one SubHub's Internal Pages field, and SubHubs may not link to themselves. \
    The External Pages field does not have these limitations. ${nextStep}`
  });
};

/**
 * Determine and return all the content types accepted by the internalPages field.
 * @param sdk The field SDK
 */
const getContentTypesAcceptedByField = (sdk: FieldExtensionSDK) => {
  if (sdk.field.items && sdk.field.items.validations) {
    const contentTypeValidations = sdk.field.items.validations.filter(validation => validation.hasOwnProperty("linkContentType")) as Array<any>;
    return contentTypeValidations.flatMap(validation => validation.linkContentType || []);
  } else {
    return []; // By default, all content types should be allowable in this collection.
  }

};

interface CustomLinkActionsProps {
  inheritedProps: LinkActionsProps,
  sdk: FieldExtensionSDK
};

const CustomLinkActions = ({inheritedProps:props, sdk}: CustomLinkActionsProps) => {
  const locale = sdk.locales.default;
  return <CombinedLinkActions
  {...props}
  onLinkExisting={index => {
    // This callback is called when the user wants to "link" existing pages to the subhub's internalPages collection.
    const contentTypes = getContentTypesAcceptedByField(sdk);
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
        const subhubSys = sdk.entry.getSys();
        return Promise.all(
          entries.map(entry => checkPageReferences(sdk, subhubSys, (entry as Entry).sys))
        ).then(results => {
          const failedEntries = entries.filter((entry, i) => !results[i]);
          if (failedEntries.length === 0) {
            // All OK! Will add all entries to entry list.
            props.onLinkedExisting(entries as Entry[], index);
            return;
          } else {
            // There were some pages that didn't pass the check. Do not allow them to be entered.
            const hasMultiplePages = entries.length !== 1;
            const failedPageNames = failedEntries.map(entry => {
              const title = (entry as Entry).fields.title;
              return title ? title[locale] : "(Untitled content)";
            });
            doFailedAlertDialog(sdk, hasMultiplePages, failedPageNames);
            return;
          }
        });
      }).catch(reason => {
        sdk.dialogs.openAlert({
          title: "Error occurred in the SubHub link-checking application",
          message: "Sorry, an error occurred while adding your page(s) to the SubHub Internal Pages field. " +
            "Please try again. If problems persist, please message the ResearchHub team for assistance."
        });
        console.log("Error occurred in SubHub link-checking application", reason);
      });
  }}
/>
};

const Field = ({ sdk }: FieldProps) => {
  // If you only want to extend Contentful's default editing experience
  // reuse Contentful's editor components
  // -> https://www.contentful.com/developers/docs/extensibility/field-editors/
  // return <Paragraph>Hello Entry Field Component</Paragraph>;
  useEffect(() => {
    const subhubPages = sdk.field.getValue();
    console.log(subhubPages);
    if (!subhubPages || subhubPages.length < 3) {
          // Need to check in order to fix height problem;
          console.log("Setting height manually");
          sdk.window.updateHeight(700);
    }
    sdk.window.startAutoResizer();
    console.log("Size is ", Math.ceil(document.documentElement.getBoundingClientRect().height));
    window.addEventListener("resize", () => {
      console.log("Size changed! New size is ", Math.ceil(document.documentElement.getBoundingClientRect().height));
    })
    return () => {
      sdk.window.stopAutoResizer();
    }
  }, [sdk.window, sdk.field]);
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
        props => <CustomLinkActions inheritedProps={props} sdk={sdk}/>
      }
    />
    {/* <CircularSubhubValidator sdk={sdk} /> */}
  </div>;

};

export default Field;
