import "module-alias/register";
import cred from "@bgauth/auth.json";
import serviceAccount from "@bgauth/serviceAccountKey.json";
import bodyParser from "body-parser";
import express from "express";
const fs = require("fs");
const admin = require("firebase-admin");
import path from "path";
const nodemailer = require("nodemailer");
const smtpTransport = require("nodemailer-smtp-transport");
const app = express();

app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://shipmodule.firebaseio.com"
});

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

const router = express.Router();

router.use("/os", require("./routes/BigCommerceAPI/API"));

const staticFiles = express.static(path.join(__dirname, "../../client/build"));
app.use(staticFiles);

router.post("/writeupc", (req, res) => {
  let rawData = fs.readFileSync("../client/src/config/upc.json");
  let queue = JSON.parse(rawData);
  queue[req.body.individualUpc] = `TEMP-${req.body.individualUpc}`;
  queue[req.body.caseUpc] = `TEMP-${req.body.individualUpc}`;
  let data = JSON.stringify(queue, null, 2);
  fs.writeFile("../client/src/config/upc.json", data, err => {
    if (err) {
      res.json({
        msg: "fail"
      });
    }
    res.json({
      msg: "success"
    });
  });
});

router.post("/writeupcinfo", (req, res) => {
  let rawData = fs.readFileSync("../client/src/config/productinfo.json");
  let queue = JSON.parse(rawData);
  queue[`TEMP-${req.body.individualUpc}`] = {
    brand: `TEMP-${req.body.individualUpc}`,
    stage: "N/A",
    package: req.body.case,
    individual: 1,
    sku: `TEMP-${req.body.individualUpc}`
  };
  let data = JSON.stringify(queue, null, 2);
  const htmlEmail = `<h3> New Product Information </h3>    
        <ul>
        <li>Individual UPC: ${req.body.individualUpc}</li>
        <li>Case UPC: ${req.body.caseUpc}</li>
        <li>Package : ${req.body.case}</li>
        <li>Image:</li>
      </ul>
      <img src=${req.body.newFile} style="width: 500px; height: 500px" />`;
  let transporter = nodemailer.createTransport(
    smtpTransport({
      service: "gmail",
      host: "smtp.gmail.email",
      auth: {
        user: cred.emailcred.user,
        pass: cred.emailcred.key
      }
    })
  );

  let mailOptions = {
    from: "yvan@organicstart.com",
    to: "yvan@organicstart.com",
    subject: "New Product Scanned Alert",
    html: htmlEmail
  };

  transporter.sendMail(mailOptions);
  fs.writeFile("../client/src/config/productinfo.json", data, err => {
    if (err) {
      res.json({
        msg: "fail"
      });
    }
    res.json({
      msg: "success"
    });
  });
});

router.put("/updateinventory", (req, res) => {
  let dataRef = admin.database().ref(`/inventory/${req.body.dbname}`);
  dataRef
    .once("value", snap => snap.val())
    .then(x => {
      if (
        (req.body.dbname === "eastcoast" || req.body.dbname === "westcoast") &&
        req.body.noEquation
      ) {
        dataRef.child(req.body.sku).update({ total: req.body.total });
      } else if (
        (req.body.dbname === "eastcoast" || req.body.dbname === "westcoast") &&
        !req.body.noEquation
      ) {
        if (req.body.broken !== 0 && req.body.obsku) {
          let tempTotal = x.val()[req.body.obsku].total + req.body.broken;
          if (tempTotal < 0) {
            tempTotal = 0;
          }
          dataRef.child(req.body.obsku).update({ total: tempTotal });
        }
        let tempTotal = x.val()[req.body.sku].total + req.body.quantity;
        if (tempTotal < 0) {
          tempTotal = 0;
        }
        dataRef.child(req.body.sku).update({ total: tempTotal });
      } else if (
        req.body.dbname === "eastcoastReport" ||
        req.body.dbname === "westcoastReport"
      ) {
        dataRef.child(req.body.sku).update({
          brand: req.body.brand,
          total: req.body.total,
          user: req.body.user,
          date: req.body.date
        });
      }
    });
  res.json({
    msg: "success"
  });
});

router.post("/writeinventorytofile", (req, res) => {
  let dataRef = admin.database().ref("/inventory");

  dataRef
    .once("value", snap => {
      let logInventory = {
        trackingNumber: req.body.trackingNumber,
        productID: req.body.productID,
        sku: req.body.sku,
        isChecked: false,
        brand: req.body.brand,
        stage: req.body.stage,
        quantity: req.body.quantity,
        broken: req.body.broken,
        invoiceNum: req.body.invoiceNum,
        total: req.body.total,
        scanner: req.body.scanner,
        warehouseLocation: req.body.warehouseLocation,
        timeStamp: req.body.timeStamp
      };
      dataRef.child("log").push(logInventory);
    })
    .then(x => {
      res.json({
        msg: "success"
      });
    })
    .catch(e => {
      res.json({
        msg: "fail"
      });
    });
});

router.post("/batchcheckemail", (req, res) => {
  let dataRef = admin.database().ref("/action/log");
  dataRef.once("value", snapshot => {
    const payload = snapshot.val();
    const result = Object.keys(payload)
      .map(key => payload[key])
      .reverse();
    let i = 0;
    let batchToCheck = [];

    result.map(data => {
      if (i > 3) return batchToCheck;
      if (
        data.batch !== req.body.batchNumber &&
        data.action === "Generate Batch"
      ) {
        data.check = false;
        batchToCheck.push(data);
        i++;
      }
    });
    for (let i in batchToCheck) {
      for (let j in result) {
        if (
          batchToCheck[i].batch === result[j].batch &&
          result[j].action === "Print"
        ) {
          batchToCheck[i].check = true;
        }
      }
    }
    let sendEmail = batchToCheck.filter(x => x.check === false);
    if (sendEmail.length > 0) {
      const htmlEmail = sendEmail.reduce((a, send) => {
        return (
          a +
          `<h3> Batch Information </h3>    
            <ul>
            <li>Batch: ${send.batch}</li>
            <li>Date: ${send.date}</li>
            <li>User: ${send.user}</li>
            <li>Picker: ${send.picker}</li>
            <li>Shipper: ${send.shipper}</li>
          </ul>`
        );
      }, "");

      let transporter = nodemailer.createTransport(
        smtpTransport({
          service: "gmail",
          host: "smtp.gmail.email",
          auth: {
            user: cred.emailcred.user,
            pass: cred.emailcred.key
          }
        })
      );

      let mailOptions = {
        from: "yvan@organicstart.com",
        to: "yvan@organicstart.com",
        subject: "Print Alert",
        html: htmlEmail
      };

      transporter.sendMail(mailOptions, err => {
        if (err) {
          res.json({
            msg: "fail"
          });
        } else {
          res.json({
            msg: "success"
          });
        }
      });
    }
  });
});

/*
update boolean -> checked [true/false] in firebase  when the user ticks the checkbox in FraudDetails 
*/
router.put("/fraud/updatefraudtofile", (req, res) => {
  let dataRef = admin.database().ref("/fraud");
  dataRef
    .orderByKey()
    .once("value", snap => {
      const payload = snap.val();

      Object.keys(payload).map(key => {
        if (req.body.orderNumber === payload[key].id) {
          dataRef.child(key).update({ checked: req.body.checked });
        }
      });
    })
    .then(x => {
      res.json({
        msg: "success"
      });
    })
    .catch(e => {
      res.json({
        msg: "fail"
      });
    });
});

/*
log all the actions user does in the app (clicking, printing, completing fraud status)
*/
router.post("/writetofile", (req, res) => {
  let dataRef = admin.database().ref(`/action`);

  dataRef
    .once("value", snap => {
      let logUser = {
        action: req.body.action,
        order: req.body.orderNumber ? req.body.orderNumber : "N/A",
        batch: req.body.batchNumber ? req.body.batchNumber : "N/A",
        user: req.body.user ? req.body.user : "N/A",
        picker: req.body.picker ? req.body.picker : "N/A",
        shipper: req.body.shipper ? req.body.shipper : "N/A",
        date: req.body.currentTime
      };
      dataRef.child("log").push(logUser);
    })
    .then(x => {
      res.json({
        msg: "success"
      });
    })
    .catch(e => {
      res.json({
        msg: "fail"
      });
    });
});

/*
save proccesssed BigCommerce API request of orders that are possibly fraudulent
*/
router.post("/fraud/writefraudtofile", (req, res) => {
  let saveUser = {};
  let dataRef = admin.database().ref(`/fraud`);

  dataRef
    .once("value", snap => {
      for (let i in req.body.saved) {
        saveUser = {
          id: req.body.saved[i].id,
          checked: req.body.saved[i].checked
            ? req.body.saved[i].checked
            : false,
          status: req.body.saved[i].status,
          orderCount: req.body.saved[i].orderCount,
          billing_address: {
            email: req.body.saved[i].billing_address.email,
            first_name: req.body.saved[i].billing_address.first_name,
            last_name: req.body.saved[i].billing_address.last_name,
            street_1: req.body.saved[i].billing_address.street_1,
            street_2: req.body.saved[i].billing_address.street_2,
            city: req.body.saved[i].billing_address.city,
            state: req.body.saved[i].billing_address.state,
            zip: req.body.saved[i].billing_address.zip,
            company: req.body.saved[i].billing_address.company,
            country: req.body.saved[i].billing_address.country,
            phone: req.body.saved[i].billing_address.phone
          },
          shippingInfo: req.body.saved[i].shippingInfo
        };

        dataRef.push(saveUser);
      }
    })
    .then(x => {
      res.json({
        msg: "success"
      });
    })
    .catch(e => {
      res.json({
        msg: "fail"
      });
    });
});

app.use(router);

// any routes not picked up by the server api will be handled by the react router
app.use("/*", staticFiles);

app.set("port", process.env.PORT || 3001);
app.listen(app.get("port"), () => {
  console.log(`Listening on ${app.get("port")}`);
});
