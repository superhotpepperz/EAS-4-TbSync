"use strict";

var EXPORTED_SYMBOLS = ["tzdb"];

Components.utils.import("resource://gre/modules/FileUtils.jsm");

const Cc = Components.classes;
const Ci = Components.interfaces;

/* * *
 * Inspired by:
 * https://developer.mozilla.org/en-US/Add-ons/Thunderbird/HowTos/Common_Thunderbird_Extension_Techniques/Use_SQLite
 */

var tzdb = {

    conn: null,
    migrate: null,
    accountColumns: ["accountname","LastSyncTime"],
    settingsCache: {}, 
    accountCache: "",   //to distinguish from null = cached value of "no accounts"

    onLoad: function() {
        // initialization code
        this.initialized = true;
        this.dbInit();
    },


    dbInit: function () {
        let dbFile = FileUtils.getFile("ProfD", ["ZPush", "db.sqlite"]);
        let dbService = Cc["@mozilla.org/storage/service;1"].getService(Ci.mozIStorageService);
        if (!dbFile.exists()) {
            this.conn = dbService.openDatabase(dbFile);

            //Create accounts table with accountColumns
            let sql = ""; for (let i=0; i<this.accountColumns.length; i++) sql = sql + ", " + this.accountColumns[i] + " TEXT";
            this.conn.executeSimpleSQL("CREATE TABLE accounts (account INTEGER PRIMARY KEY AUTOINCREMENT " + sql + ");");
            //Create settings table
            this.conn.executeSimpleSQL("CREATE TABLE settings (id INTEGER PRIMARY KEY AUTOINCREMENT, account INTEGER, name TEXT, value TEXT);");
            //Create deletelog table
            this.conn.executeSimpleSQL("CREATE TABLE deletelog (id INTEGER PRIMARY KEY AUTOINCREMENT, book TEXT, cardid TEXT);");
            this.migrate = true;
        } else {
            this.conn = dbService.openDatabase(dbFile);
            this.migrate = false;
        }
    },


    //Deletelog stuff
    addCardToDeleteLog: function (book, cardid) {
        this.conn.executeSimpleSQL("INSERT INTO deletelog (book, cardid) VALUES ('"+book+"', '"+cardid+"');");
    },

    removeCardFromDeleteLog: function (book, cardid) {
        this.conn.executeSimpleSQL("DELETE FROM deletelog WHERE book='"+book+"' AND cardid='"+cardid+"';");
    },
    
    // Remove all cards of a book from DeleteLog
    clearDeleteLog: function (book) {
        this.conn.executeSimpleSQL("DELETE FROM deletelog WHERE book='"+book+"';");
    },


    getCardsFromDeleteLog: function (book, maxnumbertosend) {
        let deletelog = [];
        let statement = this.conn.createStatement("SELECT cardid FROM deletelog WHERE book='"+book+"' LIMIT "+ maxnumbertosend +";");
        while (statement.executeStep()) {
            deletelog.push(statement.row.cardid);
        }
        return deletelog;
    },
    

    //Account stuff
    getAccounts: function () {
        //query accountCache
        if (tzdb.accountCache !== "") return tzdb.accountCache;

        let accounts = {};
        let statement = this.conn.createStatement("SELECT account, accountname FROM accounts;");
        let entries = 0;
        while (statement.executeStep()) {
            accounts[statement.row.account] = statement.row.accountname;
            entries++;
        }

        let value = null;
        if (entries>0) value = accounts;
        
        //update accountCache
        tzdb.accountCache = value;
        return value;
    },


    addAccount: function (accountname) {
        //reset accountCache
        tzdb.accountCache = "";
        
        this.conn.executeSimpleSQL("INSERT INTO accounts (accountname) VALUES ('"+accountname+"');");
        let statement = this.conn.createStatement("SELECT seq FROM sqlite_sequence where name='accounts';");
        if (statement.executeStep()) {
            return statement.row.seq;
        } else {
            return null;
        }
    },
    

    removeAccount: function (account) {
        this.conn.executeSimpleSQL("DELETE FROM accounts WHERE account='"+account+"';");
        this.conn.executeSimpleSQL("DELETE FROM settings WHERE account='"+account+"';");

        //remove settingsCache and reset accountCache
        if (tzdb.settingsCache.hasOwnProperty(account)) delete tzdb.settingsCache[account];
        tzdb.accountCache = "";
    },
    

    getIdOfSetting: function (account, name) {
        let statement = this.conn.createStatement("SELECT id FROM settings WHERE account='" + account + "' AND name='" + name +"';");
        if (statement.executeStep()) {
            return statement.row.id;
        } else {
            return null;
        }
    },


    setAccountSetting: function (account , name, value) {
        if (this.accountColumns.indexOf(name) != -1) {
            //this field is part of the accounts table with its own column
            this.conn.executeSimpleSQL("UPDATE accounts SET "+name+"='"+value+"' WHERE account='" + account + "';");
        } else {
            //this field is part of the generic settings table
            //first get id of setting
            let id = this.getIdOfSetting(account, name);
            if (id) { //UPDATE
                this.conn.executeSimpleSQL("UPDATE settings SET value='"+value+"' WHERE account='" + account + "' AND id=" + id + ";");
            } else { //INSERT
                this.conn.executeSimpleSQL("INSERT INTO settings (account,name,value) VALUES ('"+account+"','"+name+"','" +value+ "');");
            }
        }

        //also update settingsCache
        if (!tzdb.settingsCache.hasOwnProperty(account)) tzdb.settingsCache[account] = {};
        tzdb.settingsCache[account][name] = value.toString();

    },


    getAccountSetting: function (account, name) {
        let col;
        let statement;

        //query settingsCache
        if (tzdb.settingsCache.hasOwnProperty(account) && tzdb.settingsCache[account].hasOwnProperty(name)) return tzdb.settingsCache[account][name];

        if (this.accountColumns.indexOf(name) != -1) {
            //this field is part of the accounts table with its own column
            statement = this.conn.createStatement("SELECT "+name+" FROM accounts WHERE account='" + account + "';");
            col = name;
        } else {
            //this field is part of the generic settings table
            statement = this.conn.createStatement("SELECT value FROM settings WHERE account='" + account + "' AND name='" + name + "';");
            col = "value";
        }

        let value = "";
        if (statement.executeStep()) {
            value = statement.row[col];
        }
        
        //update settingsCache
        if (!tzdb.settingsCache.hasOwnProperty(account)) tzdb.settingsCache[account] = {};
        tzdb.settingsCache[account][name] = value;
            
        return value;
    },

    findAccountsWithSetting: function (name, value) {
        let statement = this.conn.createStatement("SELECT account FROM settings WHERE name='"+name+"' AND value='"+value+"';");
        let results = [];
        while (statement.executeStep()) {
            results.push(statement.row.account);
        }
        return results;
    }

};

tzdb.onLoad();
